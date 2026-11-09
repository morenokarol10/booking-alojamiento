import {
  Inject,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import { IntegrationCustomerDto } from './integration-customer.dto';
import { isValidGuestDocument } from './integration-document-validator';

const CUSTOMER_COLUMNS =
  'id,nombre_completo,tipo_documento,identificacion,email,telefono,nacionalidad,created_at,updated_at';

@Injectable()
export class IntegrationCustomerService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll() {
    const { data, error } = await this.supabase
      .from('clientes_integracion')
      .select(CUSTOMER_COLUMNS)
      .order('updated_at', { ascending: false });
    if (error) {
      throw new InternalServerErrorException(
        'No se pudieron consultar los huéspedes sincronizados. Verifica que la migración de clientes de integración esté aplicada.',
      );
    }

    return {
      data: (data ?? []).map((customer) => this.toCustomer(customer)),
      message: 'Huéspedes sincronizados consultados correctamente.',
    };
  }

  async synchronize(dto: IntegrationCustomerDto) {
    const identification = dto.identificacion.trim().toUpperCase();
    if (!isValidGuestDocument(dto.tipoDocumento, identification)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_DOCUMENT',
        detail: 'El documento del huésped no es válido.',
      });
    }
    const row = {
      nombre_completo: dto.nombreCompleto.trim(),
      tipo_documento: dto.tipoDocumento,
      identificacion: identification,
      email: dto.email.trim().toLowerCase(),
      telefono: dto.telefono.trim(),
      nacionalidad: dto.nacionalidad?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('clientes_integracion')
      .upsert(row, { onConflict: 'email' })
      .select(CUSTOMER_COLUMNS)
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(
        'No se pudo sincronizar el huésped. Verifica que la migración de clientes de integración esté aplicada.',
      );
    }

    return {
      data: this.toCustomer(data),
      message: 'Huésped sincronizado correctamente.',
    };
  }

  private toCustomer(row: Record<string, unknown>) {
    return {
      id: this.requiredString(row.id),
      nombreCompleto: this.requiredString(row.nombre_completo),
      tipoDocumento: this.requiredString(row.tipo_documento),
      identificacion: this.requiredString(row.identificacion),
      email: this.requiredString(row.email),
      telefono: this.requiredString(row.telefono),
      nacionalidad:
        typeof row.nacionalidad === 'string' ? row.nacionalidad : null,
      createdAt: this.requiredString(row.created_at),
      updatedAt: this.requiredString(row.updated_at),
    };
  }

  private requiredString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new InternalServerErrorException(
        'La base de datos devolvió un huésped con datos inválidos.',
      );
    }
    return value;
  }
}
