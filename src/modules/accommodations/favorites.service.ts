import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';

@Injectable()
export class FavoritesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findMine(userId: string) {
    const { data, error } = await this.supabase
      .from('favoritos')
      .select('alojamiento_id')
      .eq('cliente_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudieron consultar tus favoritos.',
        error: error.message,
      });
    }
    return {
      data: data.map((favorite) => favorite.alojamiento_id),
      message: 'Favoritos consultados correctamente.',
    };
  }

  async add(userId: string, accommodationId: string) {
    const { data: accommodation, error: lookupError } = await this.supabase
      .from('alojamientos')
      .select('id')
      .eq('id', accommodationId)
      .maybeSingle();
    if (lookupError) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo validar el alojamiento.',
        error: lookupError.message,
      });
    }
    if (!accommodation) {
      throw new NotFoundException('No existe el alojamiento indicado.');
    }

    const { error } = await this.supabase
      .from('favoritos')
      .upsert(
        { cliente_id: userId, alojamiento_id: accommodationId },
        { onConflict: 'cliente_id,alojamiento_id', ignoreDuplicates: true },
      );
    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo guardar el favorito.',
        error: error.message,
      });
    }
    return {
      data: { alojamientoId: accommodationId },
      message: 'Favorito guardado.',
    };
  }

  async remove(userId: string, accommodationId: string) {
    const { data, error } = await this.supabase
      .from('favoritos')
      .delete()
      .eq('cliente_id', userId)
      .eq('alojamiento_id', accommodationId)
      .select('alojamiento_id')
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudo eliminar el favorito.',
        error: error.message,
      });
    }
    if (!data) {
      throw new NotFoundException('El alojamiento no estaba en tus favoritos.');
    }
    return {
      data: { alojamientoId: data.alojamiento_id },
      message: 'Favorito eliminado.',
    };
  }
}
