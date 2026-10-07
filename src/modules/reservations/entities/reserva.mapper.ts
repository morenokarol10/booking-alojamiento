import { InternalServerErrorException } from '@nestjs/common';
import type {
  EstadoPago,
  EstadoReserva,
  ReservaEntity,
} from './reserva.entity';
import type { CreateReservaDto } from '../dto/create-reserva.dto';

export function toReservaDatabase(
  dto: CreateReservaDto,
  values: {
    clienteId: string;
    precioTotal: number;
    moneda: string;
    pagoReferencia: string;
  },
): Record<string, unknown> {
  return {
    cliente_id: values.clienteId,
    alojamiento_id: dto.alojamientoId,
    cliente_nombre: dto.clienteNombre,
    cliente_email: dto.clienteEmail,
    cliente_telefono: dto.clienteTelefono ?? null,
    fecha_checkin: dto.fechaCheckin,
    fecha_checkout: dto.fechaCheckout,
    num_huespedes: dto.numHuespedes,
    precio_total: values.precioTotal,
    moneda: values.moneda,
    metodo_pago_simulado: dto.metodoPagoSimulado,
    pago_estado: 'exitoso',
    pago_referencia: values.pagoReferencia,
    estado: 'confirmada',
  };
}

export function toReservaEntity(row: Record<string, unknown>): ReservaEntity {
  const estado = row.estado;
  const pagoEstado = row.pago_estado;
  if (!isEstadoReserva(estado) || !isEstadoPago(pagoEstado)) {
    throw new InternalServerErrorException(
      'Supabase devolvió el estado de reserva o pago no válido.',
    );
  }

  const entity: ReservaEntity = {
    id: requireString(row.id, 'id'),
    alojamientoId: requireString(row.alojamiento_id, 'alojamiento_id'),
    clienteNombre: requireString(row.cliente_nombre, 'cliente_nombre'),
    clienteEmail: requireString(row.cliente_email, 'cliente_email'),
    clienteTelefono: nullableString(row.cliente_telefono),
    fechaCheckin: requireString(row.fecha_checkin, 'fecha_checkin'),
    fechaCheckout: requireString(row.fecha_checkout, 'fecha_checkout'),
    numHuespedes: requireNumber(row.num_huespedes, 'num_huespedes'),
    precioTotal: requireNumber(row.precio_total, 'precio_total'),
    moneda: requireString(row.moneda, 'moneda'),
    metodoPagoSimulado: requireString(
      row.metodo_pago_simulado,
      'metodo_pago_simulado',
    ),
    pagoEstado,
    pagoReferencia: nullableString(row.pago_referencia),
    estado,
    createdAt: requireString(row.created_at, 'created_at'),
  };

  const accommodation = row.alojamientos;
  if (isRecord(accommodation)) {
    entity.alojamiento = {
      id: requireString(accommodation.id, 'alojamientos.id'),
      nombre: requireString(accommodation.nombre, 'alojamientos.nombre'),
      ciudad: requireString(accommodation.ciudad, 'alojamientos.ciudad'),
    };
  }
  return entity;
}

function isEstadoReserva(value: unknown): value is EstadoReserva {
  return (
    value === 'pendiente' || value === 'confirmada' || value === 'cancelada'
  );
}

function isEstadoPago(value: unknown): value is EstadoPago {
  return value === 'pendiente' || value === 'exitoso' || value === 'fallido';
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InternalServerErrorException(
      `Supabase devolvió un valor inválido para ${field}.`,
    );
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new InternalServerErrorException(
      'Supabase devolvió un campo de texto con formato no válido.',
    );
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new InternalServerErrorException(
      `Supabase devolvió un valor numérico inválido para ${field}.`,
    );
  }
  return numberValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
