import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import { CreateReservaDto } from './dto/create-reserva.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { toReservaDatabase, toReservaEntity } from './entities/reserva.mapper';

@Injectable()
export class ReservationsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async create(dto: CreateReservaDto, user: AuthenticatedUser) {
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

    const { data: reservasExistentes, error: disponibilidadError } =
      await this.supabase
        .from('reservas')
        .select('id')
        .eq('alojamiento_id', dto.alojamientoId)
        .neq('estado', 'cancelada')
        .lt('fecha_checkin', dto.fechaCheckout)
        .gt('fecha_checkout', dto.fechaCheckin);

    if (disponibilidadError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo comprobar la disponibilidad de fechas.',
        error: disponibilidadError.message,
      });
    }
    if (
      (reservasExistentes?.length ?? 0) >=
      Number(alojamiento.habitaciones_disponibles)
    ) {
      throw new BadRequestException(
        'No hay habitaciones disponibles para esas fechas.',
      );
    }

    const precioTotal =
      Math.round(Number(alojamiento.precio_base_noche) * nights * 100) / 100;
    const pagoReferencia = randomUUID();

    // Simulación local: no se contacta una pasarela ni se procesa dinero real.
    const { data: reserva, error: reservaError } = await this.supabase
      .from('reservas')
      .insert(
        toReservaDatabase(dto, {
          precioTotal,
          moneda: String(alojamiento.moneda),
          pagoReferencia,
          clienteId: user.id,
        }),
      )
      .select('*')
      .single();

    if (reservaError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo registrar la reserva.',
        error: reservaError.message,
      });
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

    if (eventError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message:
          'La reserva quedó registrada, pero no se pudo emitir el evento asociado.',
        error: eventError.message,
      });
    }

    return {
      data: reservaEntity,
      pago: {
        estado: 'exitoso',
        referencia: pagoReferencia,
        simulado: true,
      },
      message: 'Reserva confirmada y evento registrado correctamente.',
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

  private getNights(start: string, end: string): number {
    const startTime = Date.parse(`${start}T00:00:00Z`);
    const endTime = Date.parse(`${end}T00:00:00Z`);
    return (endTime - startTime) / 86_400_000;
  }
}
