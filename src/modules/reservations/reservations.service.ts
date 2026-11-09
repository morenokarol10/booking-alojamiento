import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { CancelReservaDto } from './dto/cancel-reserva.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { toReservaDatabase, toReservaEntity } from './entities/reserva.mapper';
import { CheckinReservaDto } from './dto/checkin-reserva.dto';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateReservaDto, user: AuthenticatedUser) {
    const clienteNombre = user.fullName?.trim();
    const clienteEmail = user.email.trim();
    const clienteTelefono = user.phone?.trim();
    if (!clienteNombre || !clienteEmail || !clienteTelefono) {
      throw new BadRequestException(
        'El perfil autenticado debe incluir nombre completo, correo y teléfono para realizar una reserva.',
      );
    }

    const nights = this.getNights(dto.fechaCheckin, dto.fechaCheckout);
    if (nights <= 0) {
      throw new BadRequestException(
        'fechaCheckout debe ser posterior a fechaCheckin.',
      );
    }

    const { data: alojamiento, error: alojamientoError } = await this.supabase
      .from('alojamientos')
      .select(
        'id, precio_base_noche, moneda, capacidad_maxima, habitaciones_disponibles',
      )
      .eq('id', dto.alojamientoId)
      .maybeSingle();

    if (alojamientoError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo validar el alojamiento.',
        error: alojamientoError.message,
      });
    }
    if (!alojamiento) {
      throw new NotFoundException(
        `No existe el alojamiento ${dto.alojamientoId}.`,
      );
    }
    if (dto.numHuespedes > Number(alojamiento.capacidad_maxima)) {
      throw new BadRequestException(
        'El número de huéspedes supera la capacidad máxima del alojamiento.',
      );
    }

    const precioTotal =
      Math.round(Number(alojamiento.precio_base_noche) * nights * 100) / 100;
    const pagoReferencia = randomUUID();

    // Simulación local: no se contacta una pasarela ni se procesa dinero real.
    const reservaDatabase = toReservaDatabase(dto, {
      precioTotal,
      moneda: String(alojamiento.moneda),
      pagoReferencia,
      clienteId: user.id,
      clienteNombre,
      clienteEmail,
      clienteTelefono,
    });
    const { data: reserva, error: reservaError } = await this.supabase
      .rpc('book_accommodation_if_available', {
        p_alojamiento_id: reservaDatabase.alojamiento_id,
        p_cliente_id: reservaDatabase.cliente_id,
        p_cliente_nombre: reservaDatabase.cliente_nombre,
        p_cliente_email: reservaDatabase.cliente_email,
        p_cliente_telefono: reservaDatabase.cliente_telefono,
        p_fecha_checkin: reservaDatabase.fecha_checkin,
        p_fecha_checkout: reservaDatabase.fecha_checkout,
        p_num_huespedes: reservaDatabase.num_huespedes,
        p_precio_total: reservaDatabase.precio_total,
        p_moneda: reservaDatabase.moneda,
        p_metodo_pago_simulado: reservaDatabase.metodo_pago_simulado,
        p_pago_referencia: reservaDatabase.pago_referencia,
      })
      .single();

    if (reservaError) {
      this.logger.error(
        `No se pudo insertar la reserva (código Supabase: ${reservaError.code ?? 'desconocido'}).`,
      );
      if (
        reservaError.code === 'P0001' &&
        reservaError.message === 'NO_ROOMS_AVAILABLE'
      ) {
        throw new ConflictException(
          'No hay habitaciones disponibles para esas fechas. Elige otras fechas o consulta otro alojamiento.',
        );
      }
      if (
        reservaError.code === 'P0002' &&
        reservaError.message === 'ACCOMMODATION_NOT_FOUND'
      ) {
        throw new NotFoundException(
          `No existe el alojamiento ${dto.alojamientoId}.`,
        );
      }
      if (
        reservaError.code === '22023' &&
        reservaError.message === 'GUEST_CAPACITY_EXCEEDED'
      ) {
        throw new BadRequestException(
          'El número de huéspedes supera la capacidad máxima del alojamiento.',
        );
      }

      const schemaOutOfDate =
        ['PGRST202', 'PGRST204', '42703'].includes(reservaError.code ?? '') &&
        /book_accommodation_if_available|cliente_id|metodo_pago_simulado|pago_estado/i.test(
          reservaError.message,
        );
      throw new InternalServerErrorException({
        statusCode: 500,
        message: schemaOutOfDate
          ? 'Supabase aún no tiene actualizado el esquema de reservas o la función de disponibilidad. Ejecuta database/migrations/20261013_atomic_booking_availability.sql en el SQL Editor de Supabase y vuelve a intentarlo.'
          : 'No se pudo registrar la reserva.',
        error: reservaError.message,
      });
    }

    if (!isDatabaseRow(reserva)) {
      throw new InternalServerErrorException(
        'Supabase no devolvió la reserva creada.',
      );
    }
    const reservaEntity = toReservaEntity(reserva);
    const eventPayload = {
      eventId: randomUUID(),
      eventType: 'ReservaRealizadaEvent',
      occurredAt: new Date().toISOString(),
      data: reservaEntity,
    };
    const { error: eventError } = await this.supabase
      .from('eventos_log')
      .insert({
        tipo_evento: 'ReservaRealizadaEvent',
        payload: eventPayload,
      });

    const warning = eventError
      ? 'La reserva quedó registrada, pero el evento no pudo guardarse. Contacta al soporte si no aparece en el panel.'
      : undefined;
    if (eventError) {
      this.logger.error(
        `Reserva ${reservaEntity.id} guardada sin evento (código: ${eventError.code ?? 'desconocido'}).`,
      );
    }

    return {
      data: reservaEntity,
      pago: {
        estado: 'exitoso',
        referencia: pagoReferencia,
        simulado: true,
      },
      message: warning
        ? 'Reserva confirmada con una advertencia de registro.'
        : 'Reserva confirmada y evento registrado correctamente.',
      ...(warning ? { warning } : {}),
    };
  }

  async cancel(
    reservationId: string,
    dto: CancelReservaDto,
    user: AuthenticatedUser,
  ) {
    if (dto.confirmacionPagoSimulado !== true) {
      throw new BadRequestException(
        'Debes confirmar la validación de pago simulado.',
      );
    }

    const { data: existing, error: lookupError } = await this.supabase
      .from('reservas')
      .select('id, estado, fecha_checkin')
      .eq('id', reservationId)
      .eq('cliente_id', user.id)
      .maybeSingle();
    if (lookupError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo consultar la reserva para cancelarla.',
        error: lookupError.message,
      });
    }
    if (!existing) {
      throw new NotFoundException('No se encontró una reserva cancelable.');
    }
    if (
      existing.estado !== 'confirmada' ||
      typeof existing.fecha_checkin !== 'string' ||
      existing.fecha_checkin <= new Date().toISOString().slice(0, 10)
    ) {
      throw new ConflictException(
        'Solo se pueden cancelar reservas confirmadas cuya fecha de inicio aún no llega.',
      );
    }

    const { data: reservation, error: updateError } = await this.supabase
      .from('reservas')
      .update({ estado: 'cancelada' })
      .eq('id', reservationId)
      .eq('cliente_id', user.id)
      .eq('estado', 'confirmada')
      .select('*')
      .maybeSingle();
    if (updateError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo cancelar la reserva.',
        error: updateError.message,
      });
    }
    if (!reservation) {
      throw new ConflictException(
        'La reserva cambió de estado y ya no se puede cancelar.',
      );
    }

    const cancellationReference = randomUUID();
    const reservationEntity = toReservaEntity(reservation);
    const eventPayload = {
      eventId: randomUUID(),
      eventType: 'ReservaCanceladaEvent',
      occurredAt: new Date().toISOString(),
      data: {
        reservaId: reservationId,
        clienteId: user.id,
        pagoCancelacion: {
          estado: 'simulado',
          referencia: cancellationReference,
        },
      },
    };
    const { error: eventError } = await this.supabase
      .from('eventos_log')
      .insert({
        tipo_evento: 'ReservaCanceladaEvent',
        payload: eventPayload,
      });

    const warning = eventError
      ? 'La cancelación se guardó, pero no se pudo registrar su evento.'
      : undefined;
    if (eventError) {
      this.logger.error(
        `Reserva ${reservationId} cancelada sin evento (código: ${eventError.code ?? 'desconocido'}).`,
      );
    }

    return {
      data: reservationEntity,
      pagoCancelacion: {
        estado: 'simulado',
        referencia: cancellationReference,
        simulado: true,
      },
      message:
        'Reserva cancelada. No se procesó una transacción ni una devolución real.',
      ...(warning ? { warning } : {}),
    };
  }

  async findAll() {
    const { data, error } = await this.supabase
      .from('reservas')
      .select('*, alojamientos (id, nombre, ciudad)')
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudieron consultar las reservas.',
        error: error.message,
      });
    }

    return {
      data: data.map((row: Record<string, unknown>) => toReservaEntity(row)),
      message: 'Reservas consultadas correctamente.',
    };
  }

  async checkIn(externalOrderId: string, dto: CheckinReservaDto) {
    const { data: reservation, error: lookupError } = await this.supabase
      .from('reservas')
      .select(
        'id,external_order_id,estado_integracion,huespedes_reales,fecha_checkin,fecha_checkout',
      )
      .eq('external_order_id', externalOrderId)
      .maybeSingle();
    if (lookupError) {
      throw new InternalServerErrorException(
        'No se pudo consultar la reserva para registrar el check-in.',
      );
    }
    if (!reservation) {
      throw new NotFoundException(
        'No se encontró una reserva vinculada a ese identificador externo.',
      );
    }
    if (reservation.estado_integracion === 'CHECKED_IN') {
      if (Number(reservation.huespedes_reales) !== dto.huespedesReales) {
        throw new ConflictException(
          'El check-in ya fue registrado con otro número de huéspedes.',
        );
      }
      return {
        data: {
          external_order_id: externalOrderId,
          estado: 'CONFIRMADO_ASISTIDO',
          huespedes_reales: dto.huespedesReales,
        },
        message: 'El check-in presencial ya estaba registrado.',
      };
    }
    if (reservation.estado_integracion !== 'CONFIRMED') {
      throw new ConflictException(
        'Solo se puede registrar el check-in de una reserva confirmada.',
      );
    }
    const localNow = this.guayaquilDateTime();
    if (
      localNow.date < String(reservation.fecha_checkin) ||
      localNow.date >= String(reservation.fecha_checkout)
    ) {
      throw new ConflictException(
        'El check-in solo se puede registrar durante las fechas de la reserva.',
      );
    }
    if (localNow.minutes < 14 * 60) {
      throw new UnprocessableEntityException({
        code: 'CHECKIN_TIME_NOT_REACHED',
        detail:
          'El check-in presencial se habilita a partir de las 14:00 hora de Guayaquil.',
      });
    }

    const apiKey = this.config.get<string>('API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Falta configurar API_KEY para enviar el check-in a Booking Core.',
      );
    }

    const baseUrl =
      this.config.get<string>('BOOKING_CORE_API_URL') ??
      'https://booking-core-api.azurewebsites.net';
    let checkinUrl: URL;
    try {
      checkinUrl = new URL(
        `/api/v1/reservas/${encodeURIComponent(externalOrderId)}/checkin`,
        baseUrl,
      );
    } catch {
      throw new ServiceUnavailableException(
        'BOOKING_CORE_API_URL no contiene una URL válida.',
      );
    }
    if (checkinUrl.protocol !== 'https:') {
      throw new ServiceUnavailableException(
        'BOOKING_CORE_API_URL debe usar HTTPS para proteger la API key.',
      );
    }

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(checkinUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          external_order_id: externalOrderId,
          estado: 'CONFIRMADO_ASISTIDO',
          huespedes_reales: dto.huespedesReales,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo contactar Booking Core para la orden ${externalOrderId} (${error instanceof Error ? error.name : 'error de red'}).`,
      );
      throw new ServiceUnavailableException(
        'No se pudo contactar Booking Core para confirmar el check-in. Inténtalo nuevamente.',
      );
    }
    if (!upstreamResponse.ok) {
      throw new BadGatewayException({
        message: 'Booking Core rechazó el registro de check-in.',
        upstreamStatus: upstreamResponse.status,
      });
    }

    const { data: updated, error: updateError } = await this.supabase
      .from('reservas')
      .update({
        estado_integracion: 'CHECKED_IN',
        huespedes_reales: dto.huespedesReales,
      })
      .eq('id', reservation.id)
      .eq('estado_integracion', 'CONFIRMED')
      .select('id')
      .maybeSingle();
    if (updateError || !updated) {
      this.logger.error(
        `Booking Core confirmó el check-in, pero no se pudo actualizar la orden ${externalOrderId} en Supabase.`,
      );
      throw new InternalServerErrorException(
        'Booking Core confirmó el check-in, pero no se pudo actualizar su estado local. Contacta soporte antes de reintentar.',
      );
    }

    return {
      data: {
        external_order_id: externalOrderId,
        estado: 'CONFIRMADO_ASISTIDO',
        huespedes_reales: dto.huespedesReales,
      },
      message: 'Check-in presencial confirmado por Booking Core.',
    };
  }

  async findMine(user: AuthenticatedUser) {
    const { data, error } = await this.supabase
      .from('reservas')
      .select('*, alojamientos (id, nombre, ciudad)')
      .eq('cliente_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudieron consultar tus reservas.',
        error: error.message,
      });
    }

    return {
      data: data.map((row: Record<string, unknown>) => toReservaEntity(row)),
      message: 'Tus reservas fueron consultadas correctamente.',
    };
  }

  private getNights(start: string, end: string): number {
    const startTime = Date.parse(`${start}T00:00:00Z`);
    const endTime = Date.parse(`${end}T00:00:00Z`);
    return (endTime - startTime) / 86_400_000;
  }

  private guayaquilDateTime(): { date: string; minutes: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Guayaquil',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      minutes: Number(values.hour) * 60 + Number(values.minute),
    };
  }
}

function isDatabaseRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
