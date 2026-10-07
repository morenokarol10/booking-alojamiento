import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';

@Injectable()
export class AdminService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findEvents(limitValue?: string) {
    const limit = limitValue === undefined ? 50 : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100.');
    }

    const { data, error } = await this.supabase
      .from('eventos_log')
      .select('id, tipo_evento, payload, creado_en')
      .order('creado_en', { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: 'No se pudieron consultar los eventos registrados.',
        error: error.message,
      });
    }

    return {
      data: data.map((row: Record<string, unknown>) => ({
        id: row.id,
        tipoEvento: row.tipo_evento,
        payload: row.payload,
        creadoEn: row.creado_en,
      })),
      message: 'Eventos consultados correctamente.',
    };
  }
}
