import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import { CreateAlojamientoDto } from './dto/create-alojamiento.dto';
import { TipoHabitacionInputDto } from './dto/tipo-habitacion-input.dto';
import { UpdateAlojamientoDto } from './dto/update-alojamiento.dto';
import {
  toAlojamientoDatabase,
  toAlojamientoEntity,
} from './entities/alojamiento.mapper';

@Injectable()
export class AccommodationsService {
  private readonly table = 'alojamientos';

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(ciudad?: string, precioMaximo?: number) {
    let query = this.supabase
      .from(this.table)
      .select(
        '*, tipos_habitacion (codigo, nombre, descripcion, capacidad_maxima, habitaciones_totales, numero_camas, camas, precio_base_noche, activo)',
      )
      .order('created_at', { ascending: false });

    if (ciudad) {
      query = query.ilike('ciudad', `%${this.escapeLike(ciudad)}%`);
    }
    if (precioMaximo !== undefined) {
      query = query.lte('precio_base_noche', precioMaximo);
    }

    const { data, error } = await query;
    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudieron consultar los alojamientos.',
        error: error.message,
      });
    }

    return {
      data: data.map((row: Record<string, unknown>) =>
        toAlojamientoEntity(row),
      ),
      message: 'Alojamientos consultados correctamente.',
    };
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase
      .from(this.table)
      .select(
        '*, tipos_habitacion (codigo, nombre, descripcion, capacidad_maxima, habitaciones_totales, numero_camas, camas, precio_base_noche, activo)',
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo consultar el alojamiento.',
        error: error.message,
      });
    }
    if (!data) {
      throw new NotFoundException(`No existe el alojamiento ${id}.`);
    }

    return {
      data: toAlojamientoEntity(data),
      message: 'Alojamiento consultado correctamente.',
    };
  }

  async create(dto: CreateAlojamientoDto) {
    let data: Record<string, unknown>;
    try {
      const result = await this.supabase
        .from(this.table)
        .insert(toAlojamientoDatabase(dto, true))
        .select('*')
        .single();

      if (result.error) {
        console.error('Supabase create alojamiento error:', result.error);
        const schemaCacheError =
          result.error.code === 'PGRST204' ||
          /schema cache|column .* does not exist/i.test(result.error.message);
        if (schemaCacheError) {
          throw new InternalServerErrorException(
            'El esquema de Supabase está desactualizado. Ejecuta database/migrations/20261010_render_schema_cache.sql y vuelve a desplegar.',
          );
        }
        const message = `No se pudo crear el alojamiento: ${result.error.message}`;
        if (
          result.error.code?.startsWith('22') ||
          result.error.code?.startsWith('23')
        ) {
          throw new BadRequestException(message);
        }
        throw new InternalServerErrorException(message);
      }
      if (!result.data) {
        throw new InternalServerErrorException(
          'Supabase no devolvió el alojamiento creado.',
        );
      }
      data = result.data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Unexpected error creating alojamiento:', error);
      const details =
        error instanceof Error ? error.message : 'Error desconocido.';
      throw new InternalServerErrorException(
        `No se pudo crear el alojamiento: ${details}`,
      );
    }

    if (!dto.tiposHabitacion) {
      return {
        data: toAlojamientoEntity(data),
        message: 'Alojamiento creado correctamente.',
      };
    }
    await this.syncRoomTypes(String(data.id), dto.tiposHabitacion);
    const created = await this.findOne(String(data.id));
    return {
      data: created.data,
      message: 'Alojamiento creado correctamente.',
    };
  }

  async update(id: string, dto: UpdateAlojamientoDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe proporcionar al menos un campo para actualizar.',
      );
    }

    const changes = toAlojamientoDatabase(dto);
    if (Object.keys(changes).length > 0) {
      const { data, error } = await this.supabase
        .from(this.table)
        .update(changes)
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException({
          statusCode: 500,
          message: 'No se pudo actualizar el alojamiento.',
          error: error.message,
        });
      }
      if (!data) {
        throw new NotFoundException(`No existe el alojamiento ${id}.`);
      }
    } else {
      await this.findOne(id);
    }

    if (dto.tiposHabitacion) {
      await this.syncRoomTypes(id, dto.tiposHabitacion);
    }
    const updated = await this.findOne(id);
    return {
      data: updated.data,
      message: 'Alojamiento actualizado correctamente.',
    };
  }

  /**
   * Guarda los tipos de habitación del alojamiento (cuántas habitaciones de
   * cada tipo, camas, huéspedes y precio) y recalcula los totales del
   * alojamiento. No permite dejar menos habitaciones de las que ya están
   * reservadas para una misma noche futura.
   */
  private async syncRoomTypes(
    alojamientoId: string,
    roomTypes: TipoHabitacionInputDto[],
  ) {
    if (roomTypes.length === 0) {
      throw new BadRequestException(
        'El alojamiento debe tener al menos un tipo de habitación.',
      );
    }
    if (!roomTypes.some((room) => room.cantidad > 0)) {
      throw new BadRequestException(
        'Al menos un tipo de habitación debe tener 1 habitación o más.',
      );
    }

    const { data: existing, error: existingError } = await this.supabase
      .from('tipos_habitacion')
      .select('id,codigo,nombre,activo')
      .eq('alojamiento_id', alojamientoId);
    if (existingError) {
      throw new InternalServerErrorException(
        'No se pudieron consultar las habitaciones del alojamiento.',
      );
    }
    const existingRows = (existing ?? []) as Array<{
      id: string;
      codigo: string;
      nombre: string;
      activo: boolean;
    }>;

    const usedCodes = new Set<string>();
    const rows = roomTypes.map((room) => {
      let code = room.codigo ?? roomTypeCode(room.nombre);
      if (!room.codigo) {
        let suffix = 2;
        const base = code.slice(0, 36);
        while (usedCodes.has(code)) code = `${base}_${suffix++}`;
      }
      if (usedCodes.has(code)) {
        throw new BadRequestException(
          `El tipo de habitación ${code} está repetido.`,
        );
      }
      usedCodes.add(code);
      return {
        alojamiento_id: alojamientoId,
        codigo: code,
        nombre: room.nombre,
        descripcion: room.descripcion || null,
        habitaciones_totales: room.cantidad,
        numero_camas: room.camas,
        camas:
          room.descripcionCamas ||
          `${room.camas} ${room.camas === 1 ? 'cama' : 'camas'}`,
        capacidad_maxima: room.capacidadAdultos,
        precio_base_noche: room.precioNoche,
        activo: true,
      };
    });

    const removed = existingRows.filter(
      (row) => row.activo && !usedCodes.has(row.codigo),
    );
    const requestedByCode = new Map(
      rows.map((row) => [row.codigo, row.habitaciones_totales]),
    );
    const idsToCheck = existingRows
      .filter((row) => row.activo)
      .map((row) => row.id);
    if (idsToCheck.length > 0) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Guayaquil',
      }).format(new Date());
      const { data: reservations, error: reservationsError } =
        await this.supabase
          .from('reservas')
          .select(
            'tipo_habitacion_id,fecha_checkin,fecha_checkout,cantidad_habitaciones',
          )
          .in('tipo_habitacion_id', idsToCheck)
          .not('estado_integracion', 'in', '(CANCELLED,CHECKED_OUT)')
          .gt('fecha_checkout', today);
      if (reservationsError) {
        throw new InternalServerErrorException(
          'No se pudieron revisar las reservas del alojamiento.',
        );
      }
      for (const row of existingRows.filter((item) => item.activo)) {
        const reservedPeak = peakRoomsReserved(
          (reservations ?? []).filter(
            (reservation) => reservation.tipo_habitacion_id === row.id,
          ),
          today,
        );
        const requested = requestedByCode.get(row.codigo) ?? 0;
        if (reservedPeak > requested) {
          throw new ConflictException(
            requested === 0
              ? `No puedes quitar "${row.nombre}": tiene ${reservedPeak} habitación(es) reservada(s) en fechas próximas.`
              : `"${row.nombre}" tiene ${reservedPeak} habitación(es) reservada(s) para una misma noche; no puedes dejar solo ${requested}.`,
          );
        }
      }
    }

    const { error: upsertError } = await this.supabase
      .from('tipos_habitacion')
      .upsert(rows, { onConflict: 'alojamiento_id,codigo' });
    if (upsertError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudieron guardar las habitaciones.',
        error: upsertError.message,
      });
    }
    if (removed.length > 0) {
      const { error: deactivateError } = await this.supabase
        .from('tipos_habitacion')
        .update({ activo: false })
        .in(
          'id',
          removed.map((row) => row.id),
        );
      if (deactivateError) {
        throw new InternalServerErrorException(
          'No se pudieron retirar los tipos de habitación eliminados.',
        );
      }
    }

    const offered = rows.filter((row) => row.habitaciones_totales > 0);
    const { error: summaryError } = await this.supabase
      .from(this.table)
      .update({
        habitaciones_disponibles: rows.reduce(
          (sum, row) => sum + row.habitaciones_totales,
          0,
        ),
        capacidad_maxima: Math.max(
          ...offered.map((row) => row.capacidad_maxima),
        ),
        precio_base_noche: Math.min(
          ...offered.map((row) => row.precio_base_noche),
        ),
      })
      .eq('id', alojamientoId);
    if (summaryError) {
      throw new InternalServerErrorException(
        'No se pudieron actualizar los totales del alojamiento.',
      );
    }
  }

  async remove(id: string) {
    const { data, error } = await this.supabase
      .from(this.table)
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error?.code === '23503') {
      throw new ConflictException(
        'No se puede eliminar un alojamiento con reservas asociadas.',
      );
    }
    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo eliminar el alojamiento.',
        error: error.message,
      });
    }
    if (!data) {
      throw new NotFoundException(`No existe el alojamiento ${id}.`);
    }

    return {
      data: { id: data.id, deleted: true },
      message: 'Alojamiento eliminado correctamente.',
    };
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }
}

/** Código estable a partir del nombre: "Habitación doble" → HABITACION_DOBLE. */
export function roomTypeCode(name: string): string {
  const code = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'HABITACION';
}

/** Máximo de habitaciones reservadas a la vez en una misma noche futura. */
export function peakRoomsReserved(
  reservations: Array<Record<string, unknown>>,
  today: string,
): number {
  let peak = 0;
  for (const reservation of reservations) {
    const start = String(reservation.fecha_checkin);
    const night = start > today ? start : today;
    const total = reservations.reduce(
      (sum, other) =>
        String(other.fecha_checkin) <= night &&
        String(other.fecha_checkout) > night
          ? sum + Number(other.cantidad_habitaciones || 1)
          : sum,
      0,
    );
    peak = Math.max(peak, total);
  }
  return peak;
}
