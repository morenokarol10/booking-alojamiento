import { InternalServerErrorException } from '@nestjs/common';
import type {
  AlojamientoEntity,
  CoordenadasEntity,
} from './alojamiento.entity';
import type { CreateAlojamientoDto } from '../dto/create-alojamiento.dto';
import type { UpdateAlojamientoDto } from '../dto/update-alojamiento.dto';

const DEFAULT_COORDINATES: CoordenadasEntity = {
  latitud: -0.1807,
  longitud: -78.4678,
};

export function toAlojamientoDatabase(
  dto: CreateAlojamientoDto | UpdateAlojamientoDto,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (dto.proveedorId !== undefined) record.proveedor_id = dto.proveedorId;
  if (dto.nombre !== undefined) record.nombre = dto.nombre;
  if (dto.descripcion !== undefined) record.descripcion = dto.descripcion;
  if (dto.tipo !== undefined) record.tipo = dto.tipo;
  if (dto.ciudad !== undefined) record.ciudad = dto.ciudad;
  if (dto.direccion !== undefined) record.direccion = dto.direccion;
  if (dto.coordenadas !== undefined) {
    record.coordenadas = {
      latitud: dto.coordenadas.latitud,
      longitud: dto.coordenadas.longitud,
    };
  }
  if (dto.precioBaseNoche !== undefined) {
    record.precio_base_noche = dto.precioBaseNoche;
  }
  if (dto.moneda !== undefined) record.moneda = dto.moneda;
  if (dto.capacidadMaxima !== undefined) {
    record.capacidad_maxima = dto.capacidadMaxima;
  }
  if (dto.habitacionesDisponibles !== undefined) {
    record.habitaciones_disponibles = dto.habitacionesDisponibles;
  }
  if (dto.servicios !== undefined) record.servicios = dto.servicios;
  if (dto.politicaCancelacion !== undefined) {
    record.politica_cancelacion = dto.politicaCancelacion;
  }
  if (dto.imagenes !== undefined) record.imagenes = dto.imagenes;
  return record;
}

export function toAlojamientoEntity(
  row: Record<string, unknown>,
): AlojamientoEntity {
  if (
    row.tipo !== 'hotel' &&
    row.tipo !== 'departamento' &&
    row.tipo !== 'villa'
  ) {
    throw new InternalServerErrorException(
      'Supabase devolvió un tipo de alojamiento no reconocido.',
    );
  }

  return {
    id: requireString(row.id, 'id'),
    proveedorId: requireString(row.proveedor_id, 'proveedor_id'),
    nombre: requireString(row.nombre, 'nombre'),
    descripcion: nullableString(row.descripcion),
    tipo: row.tipo,
    ciudad: requireString(row.ciudad, 'ciudad'),
    direccion: requireString(row.direccion, 'direccion'),
    coordenadas: mapCoordinates(row.coordenadas),
    precioBaseNoche: requireNumber(row.precio_base_noche, 'precio_base_noche'),
    moneda: requireString(row.moneda, 'moneda'),
    capacidadMaxima: requireNumber(row.capacidad_maxima, 'capacidad_maxima'),
    habitacionesDisponibles: requireNumber(
      row.habitaciones_disponibles,
      'habitaciones_disponibles',
    ),
    servicios: stringArray(row.servicios, 'servicios'),
    politicaCancelacion: nullableString(row.politica_cancelacion),
    imagenes: stringArray(row.imagenes, 'imagenes'),
    createdAt: requireString(row.created_at, 'created_at'),
  };
}

function mapCoordinates(value: unknown): CoordenadasEntity {
  if (!isRecord(value)) {
    return {
      latitud: DEFAULT_COORDINATES.latitud,
      longitud: DEFAULT_COORDINATES.longitud,
    };
  }

  const latitud = coordinateNumber(value.latitud);
  const longitud = coordinateNumber(value.longitud);
  if (latitud === null || longitud === null) {
    return {
      latitud: DEFAULT_COORDINATES.latitud,
      longitud: DEFAULT_COORDINATES.longitud,
    };
  }

  return { latitud, longitud };
}

function coordinateNumber(value: unknown): number | null {
  if (
    (typeof value !== 'number' &&
      (typeof value !== 'string' || value.trim() === '')) ||
    !Number.isFinite(Number(value))
  ) {
    return null;
  }
  return Number(value);
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

function stringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new InternalServerErrorException(
      `Supabase devolvió una lista no válida para ${field}.`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
