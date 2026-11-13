import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import {
  DocumentType,
  IntegrationCustomerDto,
  IntegrationCustomerQueryDto,
} from './integration-customer.dto';
import { isValidGuestDocument } from './integration-document-validator';

const CUSTOMER_COLUMNS =
  'id,nombre_completo,tipo_documento,identificacion,email,telefono,nacionalidad,created_at,updated_at';

@Injectable()
export class IntegrationCustomerService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(query: IntegrationCustomerQueryDto = {}) {
    let request = this.supabase
      .from('clientes_integracion')
      .select(CUSTOMER_COLUMNS)
      .order('updated_at', { ascending: false });
    const identification = query.identificacion ?? query.cedula;
    if (identification) request = request.eq('identificacion', identification);
    if (query.email) request = request.eq('email', query.email.toLowerCase());

    const { data, error } = await request;
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
    const guest = this.normalize(dto);
    if (!isValidGuestDocument(guest.tipoDocumento, guest.identificacion)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_DOCUMENT',
        detail:
          guest.tipoDocumento === 'CEDULA'
            ? 'La cédula ecuatoriana no es válida.'
            : 'El documento del huésped no es válido.',
      });
    }

    // La misma identificación no puede quedar en dos correos distintos.
    const { data: sameDocument, error: lookupError } = await this.supabase
      .from('clientes_integracion')
      .select('email')
      .eq('identificacion', guest.identificacion)
      .neq('email', guest.email)
      .limit(1);
    if (lookupError) {
      throw new InternalServerErrorException(
        'No se pudo validar la identificación del huésped.',
      );
    }
    if ((sameDocument ?? []).length > 0) {
      throw new ConflictException({
        code: 'DUPLICATE_DOCUMENT',
        detail: `La identificación ${guest.identificacion} ya está registrada con otro correo.`,
      });
    }

    const row = {
      nombre_completo: guest.nombreCompleto,
      tipo_documento: guest.tipoDocumento,
      identificacion: guest.identificacion,
      email: guest.email,
      // La columna es obligatoria; Booking no siempre envía teléfono.
      telefono: guest.telefono ?? '',
      nacionalidad: guest.nacionalidad ?? null,
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

  /** Une los nombres del contrato y los de Booking en un solo huésped. */
  private normalize(dto: IntegrationCustomerDto) {
    const name =
      dto.nombreCompleto ||
      [dto.nombre, dto.apellido].filter(Boolean).join(' ').trim();
    const identification = (dto.identificacion || dto.cedula || '')
      .trim()
      .toUpperCase();
    const email = (dto.email || dto.correo || '').trim().toLowerCase();
    const missing = [
      !name && 'nombre',
      !identification && 'cédula o identificación',
      !email && 'correo',
    ].filter(Boolean);
    if (missing.length > 0 || name.length < 3) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail:
          missing.length > 0
            ? `Faltan datos del huésped: ${missing.join(', ')}.`
            : 'El nombre del huésped debe tener al menos 3 caracteres.',
      });
    }
    const type: DocumentType =
      dto.tipoDocumento ||
      dto.tipo_documento ||
      (/^[0-9]{10}$/.test(identification)
        ? 'CEDULA'
        : /^[0-9]{13}$/.test(identification)
          ? 'RUC'
          : 'PASAPORTE');
    return {
      nombreCompleto: name,
      tipoDocumento: type,
      identificacion: identification,
      email,
      telefono: dto.telefono || undefined,
      nacionalidad: dto.nacionalidad || undefined,
    };
  }

  private toCustomer(row: Record<string, unknown>) {
    return {
      id: this.requiredString(row.id),
      nombreCompleto: this.requiredString(row.nombre_completo),
      tipoDocumento: this.requiredString(row.tipo_documento),
      identificacion: this.requiredString(row.identificacion),
      cedula: this.requiredString(row.identificacion),
      email: this.requiredString(row.email),
      telefono:
        typeof row.telefono === 'string' && row.telefono ? row.telefono : null,
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
