import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { CancelReservaDto } from './dto/cancel-reserva.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { toReservaDatabase, toReservaEntity } from './entities/reserva.mapper';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
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
}

function isDatabaseRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
