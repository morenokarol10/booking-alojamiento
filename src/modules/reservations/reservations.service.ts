import { createHash, randomUUID } from 'node:crypto';
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
import { toReservaEntity } from './entities/reserva.mapper';
import { CheckinReservaDto } from './dto/checkin-reserva.dto';
import { CheckOutDto } from './dto/check-out.dto';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
  ) {}

  async create(
    dto: CreateReservaDto,
    user: AuthenticatedUser,
    idempotencyKey?: string,
  ) {
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

    const requestKey = idempotencyKey ?? randomUUID();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        requestKey,
      )
    ) {
      throw new BadRequestException(
        'Idempotency-Key debe ser un UUID versión 4.',
      );
    }

    const quantity = dto.cantidadHabitaciones ?? 1;
    const roomCode = dto.tipoHabitacionCodigo ?? 'HABITACION_ESTANDAR';
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          userId: user.id,
          clienteNombre,
          clienteEmail,
          clienteTelefono,
          alojamientoId: dto.alojamientoId,
          tipoHabitacionCodigo: roomCode,
          fechaCheckin: dto.fechaCheckin,
          fechaCheckout: dto.fechaCheckout,
          numHuespedes: dto.numHuespedes,
          cantidadHabitaciones: quantity,
          metodoPagoSimulado: dto.metodoPagoSimulado,
          cotizacionId: dto.cotizacionId ?? null,
        }),
      )
      .digest('hex');
    const pagoReferencia = randomUUID();
    const { data: result, error: reservaError } = await this.supabase.rpc(
      'book_accommodation_room_if_available',
      {
        p_idempotency_key: requestKey,
        p_request_hash: requestHash,
        p_alojamiento_id: dto.alojamientoId,
        p_tipo_habitacion_codigo: roomCode,
        p_cliente_id: user.id,
        p_cliente_nombre: clienteNombre,
        p_cliente_email: clienteEmail,
        p_cliente_telefono: clienteTelefono,
        p_fecha_checkin: dto.fechaCheckin,
        p_fecha_checkout: dto.fechaCheckout,
        p_num_huespedes: dto.numHuespedes,
        p_cantidad_habitaciones: quantity,
        p_metodo_pago_simulado: dto.metodoPagoSimulado,
        p_pago_referencia: pagoReferencia,
        p_cotizacion_id: dto.cotizacionId ?? null,
      },
    );

    if (reservaError) {
      this.logger.error(
        `No se pudo insertar la reserva (código Supabase: ${reservaError.code ?? 'desconocido'}).`,
      );
      if (
        ['NO_ROOMS_AVAILABLE', 'OUT_OF_STOCK'].some((code) =>
          reservaError.message.includes(code),
        )
      ) {
        throw new ConflictException(
          'No hay habitaciones disponibles para esas fechas. Elige otras fechas o consulta otro alojamiento.',
        );
      }
      if (reservaError.message.includes('ROOM_NOT_FOUND')) {
        throw new NotFoundException(
          'El tipo de habitación seleccionado no está disponible.',
        );
      }
      if (reservaError.message.includes('QUOTE_NOT_FOUND')) {
        throw new NotFoundException(
          'La cotización ya no existe. Consulta nuevamente el precio y la disponibilidad.',
        );
      }
      if (
        reservaError.message.includes('GUEST_CAPACITY_EXCEEDED') ||
        reservaError.message.includes('INVALID_BOOKING_DATES') ||
        reservaError.code === '22023'
      ) {
        throw new BadRequestException(
          'Revisa las fechas, la cantidad de habitaciones y la capacidad del tipo de habitación.',
        );
      }
      if (reservaError.message.includes('QUOTE_EXPIRED')) {
        throw new ConflictException(
          'La cotización venció. Consulta nuevamente el precio y la disponibilidad.',
        );
      }
      if (
        reservaError.message.includes('PRICE_MISMATCH') ||
        reservaError.message.includes('IDEMPOTENCY_KEY_REUSED')
      ) {
        throw new ConflictException(
          'La reserva cambió desde la última cotización. Vuelve a consultar disponibilidad y precio.',
        );
      }
      if (reservaError.message.includes('RESTRICTION_VIOLATED')) {
        throw new UnprocessableEntityException(
          'La estancia no cumple las restricciones de la tarifa seleccionada.',
        );
      }

      const schemaOutOfDate =
        ['PGRST202', 'PGRST204', '42703'].includes(reservaError.code ?? '') &&
        /book_accommodation_room_if_available|reservas_marketplace_idempotencia|cliente_id|tipo_habitacion_id/i.test(
          reservaError.message,
        );
      throw new InternalServerErrorException({
        statusCode: 500,
        message: schemaOutOfDate
          ? 'Supabase no tiene aplicada la migración de inventario compartido. Ejecuta database/migrations/202612120001_unified_marketplace_inventory.sql en el SQL Editor de Supabase y vuelve a intentarlo.'
          : 'No se pudo registrar la reserva.',
        error: reservaError.message,
      });
    }

    if (!isDatabaseRow(result) || !isDatabaseRow(result.reservation)) {
      throw new InternalServerErrorException(
        'Supabase no devolvió la reserva creada.',
      );
    }
    const reservaEntity = toReservaEntity(result.reservation);
    const replayed = result.replayed === true;
    const eventPayload = {
      eventId: randomUUID(),
      eventType: 'ReservaRealizadaEvent',
      occurredAt: new Date().toISOString(),
      data: reservaEntity,
    };
    let eventError: { code?: string } | null = null;
    if (!replayed) {
      const { error } = await this.supabase.from('eventos_log').insert({
        tipo_evento: 'ReservaRealizadaEvent',
        payload: eventPayload,
      });
      eventError = error;
    }

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
        referencia: reservaEntity.pagoReferencia,
        simulado: true,
      },
      message: warning
        ? 'Reserva confirmada con una advertencia de registro.'
        : replayed
          ? 'La solicitud ya había sido procesada; se devolvió la reserva original.'
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
      .select(
        '*, alojamientos (id, nombre, ciudad), tipos_habitacion (codigo, nombre), reservas_unidades_habitacion (unidades_habitacion (id, codigo, estado, limpieza_hasta))',
      )
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

    const { error: roomValidationError } = await this.supabase.rpc(
      'validate_alojamiento_checkin_room_state',
      { p_reservation_id: reservation.id },
    );
    if (roomValidationError) {
      this.throwRoomOperationError(
        roomValidationError,
        'validar la habitación antes del check-in',
      );
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
      if (
        updateError?.message.includes('ROOM_STILL_CLEANING') ||
        updateError?.message.includes('ROOM_STILL_OCCUPIED')
      ) {
        throw new ConflictException(
          'La habitación asignada todavía no está disponible.',
        );
      }
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

  async checkInMarketplace(reservationId: string, dto: CheckinReservaDto) {
    const { data: reservation, error: lookupError } = await this.supabase
      .from('reservas')
      .select(
        'id,external_order_id,estado_integracion,huespedes_reales,fecha_checkin,fecha_checkout',
      )
      .eq('id', reservationId)
      .maybeSingle();
    if (lookupError) {
      throw new InternalServerErrorException(
        'No se pudo consultar la reserva para registrar el check-in.',
      );
    }
    if (!reservation) {
      throw new NotFoundException('No se encontró la reserva.');
    }
    if (reservation.external_order_id) {
      throw new ConflictException(
        'Las reservas de Booking deben confirmar el check-in con Booking Core.',
      );
    }
    if (reservation.estado_integracion === 'CHECKED_IN') {
      if (Number(reservation.huespedes_reales) !== dto.huespedesReales) {
        throw new ConflictException(
          'El check-in ya fue registrado con otro número de huéspedes.',
        );
      }
      return {
        data: { orderId: reservation.id, estado: 'CHECKED_IN' },
        message: 'El check-in ya estaba registrado.',
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
    if (updateError) {
      if (
        updateError.message.includes('ROOM_STILL_CLEANING') ||
        updateError.message.includes('ROOM_STILL_OCCUPIED')
      ) {
        throw new ConflictException(
          'La habitación asignada todavía no está disponible.',
        );
      }
      this.logger.error(
        `No se pudo actualizar el estado de check-in de la reserva ${reservation.id} (código Supabase: ${updateError.code ?? 'desconocido'}).`,
      );
      throw new InternalServerErrorException(
        'No se pudo registrar el check-in.',
      );
    }
    if (!updated) {
      throw new ConflictException(
        'La reserva cambió de estado antes de registrar el check-in.',
      );
    }
    return {
      data: { orderId: reservation.id, estado: 'CHECKED_IN' },
      message: 'Check-in registrado correctamente.',
    };
  }

  async checkOut(reservationId: string, dto: CheckOutDto) {
    const { data, error } = await this.supabase.rpc(
      'checkout_alojamiento_order_v2',
      {
        p_order_ref: reservationId,
        p_correlation_id: randomUUID(),
        p_consumos: dto.consumosMinibar ?? [],
        p_metodo_pago: dto.metodoPagoConsumos ?? null,
      },
    );
    if (error) {
      this.throwRoomOperationError(error, 'registrar el check-out');
    }
    if (!isDatabaseRow(data)) {
      throw new InternalServerErrorException(
        'Supabase no devolvió el resultado del check-out.',
      );
    }
    return {
      data,
      message:
        'Check-out registrado. La habitación pasó a limpieza y se liberará automáticamente en 60 minutos.',
    };
  }

  async completeRoomCleaning(reservationId: string) {
    const { data, error } = await this.supabase.rpc(
      'complete_alojamiento_room_cleaning',
      { p_reservation_id: reservationId },
    );
    if (error) {
      this.throwRoomOperationError(error, 'marcar la habitación como limpia');
    }
    if (!isDatabaseRow(data)) {
      throw new InternalServerErrorException(
        'Supabase no devolvió el resultado de la limpieza.',
      );
    }
    return {
      data,
      message:
        data.yaEstabaLimpia === true
          ? 'La habitación ya estaba limpia y disponible.'
          : 'La habitación quedó limpia y disponible.',
    };
  }

  async findMine(user: AuthenticatedUser) {
    const { data, error } = await this.supabase
      .from('reservas')
      .select(
        '*, alojamientos (id, nombre, ciudad), tipos_habitacion (codigo, nombre)',
      )
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

  private throwRoomOperationError(
    error: { code?: string; message: string },
    action: string,
  ): never {
    if (error.message.includes('ORDER_NOT_FOUND')) {
      throw new NotFoundException('No se encontró la reserva.');
    }
    if (
      error.message.includes('INVALID_STATE_TRANSITION') ||
      error.message.includes('ROOM_STILL_CLEANING') ||
      error.message.includes('ROOM_STILL_OCCUPIED') ||
      error.message.includes('ROOM_ASSIGNMENT_NOT_FOUND')
    ) {
      throw new ConflictException({
        code: error.message.includes('ROOM_STILL_CLEANING')
          ? 'ROOM_STILL_CLEANING'
          : error.message.includes('ROOM_STILL_OCCUPIED')
            ? 'ROOM_STILL_OCCUPIED'
            : 'INVALID_STATE_TRANSITION',
        detail: error.message,
      });
    }
    this.logger.error(
      `No se pudo ${action} (código Supabase: ${error.code ?? 'desconocido'}).`,
    );
    throw new InternalServerErrorException(
      `No se pudo ${action}. Inténtalo nuevamente.`,
    );
  }
}

function isDatabaseRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
