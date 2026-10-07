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
      .select('*')
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
      .select('*')
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
        .insert(toAlojamientoDatabase(dto))
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

    return {
      data: toAlojamientoEntity(data),
      message: 'Alojamiento creado correctamente.',
    };
  }

  async update(id: string, dto: UpdateAlojamientoDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe proporcionar al menos un campo para actualizar.',
      );
    }

    const { data, error } = await this.supabase
      .from(this.table)
      .update(toAlojamientoDatabase(dto))
      .eq('id', id)
      .select('*')
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

    return {
      data: toAlojamientoEntity(data),
      message: 'Alojamiento actualizado correctamente.',
    };
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
