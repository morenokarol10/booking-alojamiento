import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import { IntegrationCatalogService } from './integration-catalog.service';
import {
  IntegrationCancelOrderDto,
  IntegrationOrderCreateDto,
} from './integration-order.dto';

type Guest = NonNullable<IntegrationOrderCreateDto['huespedTitular']>;
type DatabaseRow = Record<string, unknown>;

@Injectable()
export class IntegrationOrderService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly catalog: IntegrationCatalogService,
  ) {}

  async create(
    dto: IntegrationOrderCreateDto,
    idempotencyKey: string | undefined,
    correlationId: string,
  ) {
    this.validateIdempotencyKey(idempotencyKey);
    if (dto.idempotency_key && dto.idempotency_key !== idempotencyKey) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'idempotency_key debe coincidir con la cabecera.',
      });
    }
    if (dto.currency && dto.currency !== 'USD') {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_CURRENCY',
        detail: 'Este nodo solo acepta órdenes en USD.',
      });
    }
    const guest = this.normalizeGuest(dto);
    if (!this.validDocument(guest)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_DOCUMENT',
        detail: 'El documento del huésped titular no es válido.',
      });
    }

    const pricing = await this.catalog.pricingForOrder({
      accommodationCode: dto.alojamientoId,
      roomCode: dto.tipoHabitacionCodigo,
      start: dto.fechaInicio,
      end: dto.fechaFin,
      quantity: dto.cantidadHabitaciones,
      planCode: dto.planTarifaCodigo,
    });
    if (
      dto.ocupantes.adultos + dto.ocupantes.ninos >
      Number(pricing.room.capacidad_maxima) * dto.cantidadHabitaciones
    ) {
      throw new UnprocessableEntityException({
        code: 'CAPACITY_EXCEEDED',
        detail: 'La ocupación excede la capacidad de la habitación.',
      });
    }
    if (
      dto.regimenSeleccionado &&
      dto.regimenSeleccionado !== pricing.room.regimen
    ) {
      throw new UnprocessableEntityException({
        code: 'RESTRICTION_VIOLATED',
        detail:
          'El régimen seleccionado no está disponible para esta habitación.',
      });
    }

    let breakdown = pricing.breakdown;
    if (dto.cotizacionId) {
      const { data: quote, error } = await this.supabase
        .from('cotizaciones_alojamiento')
        .select(
          'id,alojamiento_id,tipo_habitacion_id,fecha_inicio,fecha_fin,cantidad_habitaciones,total_pagar,desglose,valido_hasta',
        )
        .eq('id', dto.cotizacionId)
        .maybeSingle();
      if (error) {
        throw new InternalServerErrorException(
          'No se pudo validar la cotización.',
        );
      }
      if (!quote) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          detail: 'No se encontró la cotización.',
        });
      }
      if (Date.parse(String(quote.valido_hasta)) <= Date.now()) {
        throw new ConflictException({
          code: 'QUOTE_EXPIRED',
          detail: 'La cotización venció; solicita una nueva.',
        });
      }
      if (
        quote.alojamiento_id !== pricing.accommodation.id ||
        quote.tipo_habitacion_id !== pricing.room.id ||
        quote.fecha_inicio !== dto.fechaInicio ||
        quote.fecha_fin !== dto.fechaFin ||
        Number(quote.cantidad_habitaciones) !== dto.cantidadHabitaciones
      ) {
        throw new ConflictException({
          code: 'PRICE_MISMATCH',
          detail: 'La cotización no corresponde a esta orden.',
        });
      }
      if (!isRecord(quote.desglose)) {
        throw new InternalServerErrorException(
          'La cotización almacenada no contiene un desglose válido.',
        );
      }
      breakdown = quote.desglose as typeof breakdown;
    }

    const discount = this.validatePackage(
      dto,
      pricing.accommodation,
      breakdown.subtotal,
    );
    const expectedTotal = this.formatCents(
      this.cents(breakdown.totalPagar) - discount,
    );
    if (dto.totalPagar !== expectedTotal) {
      throw new ConflictException({
        code: 'PRICE_MISMATCH',
        detail: 'totalPagar no coincide exactamente con la tarifa vigente.',
      });
    }
    const appliedBreakdown = {
      ...breakdown,
      descuentoCombo: this.formatCents(discount),
      totalPagar: expectedTotal,
    };
    const guestWithDocument: Guest = Object.assign({}, guest);
    const idSuffix = randomBytes(5).toString('hex').toUpperCase();
    const externalOrderId = `ORD-HTL-${idSuffix}`;
    const reservationCode = `BK-HOTEL-${idSuffix}`;
    const fiscalBreakdown = {
      subtotal: appliedBreakdown.subtotal,
      ivaPorcentaje: appliedBreakdown.ivaPorcentaje,
      ivaValor: appliedBreakdown.ivaValor,
      tasaMunicipal: appliedBreakdown.tasaMunicipal,
      descuentoCombo: appliedBreakdown.descuentoCombo,
      total: appliedBreakdown.totalPagar,
      impuestos: [
        {
          codigo: 'IVA',
          nombre: `IVA ${appliedBreakdown.ivaPorcentaje} %`,
          porcentaje: appliedBreakdown.ivaPorcentaje,
          monto: appliedBreakdown.ivaValor,
          incluidoEnPrecio: false,
        },
        {
          codigo: 'TASA_MUNICIPAL',
          nombre: 'Tasa municipal',
          monto: appliedBreakdown.tasaMunicipal,
          incluidoEnPrecio: false,
        },
      ],
    };
    const response = {
      external_order_id: externalOrderId,
      externalOrderId,
      codigoReserva: reservationCode,
      saga_id: dto.saga_id,
      alojamientoId: dto.alojamientoId,
      alojamientoNombre: pricing.accommodation.nombre,
      tipoHabitacionCodigo: pricing.room.codigo,
      tipoHabitacion: pricing.room.nombre,
      cantidadHabitaciones: dto.cantidadHabitaciones,
      ocupantes: dto.ocupantes,
      regimen: dto.regimenSeleccionado ?? pricing.room.regimen,
      checkinFecha: dto.fechaInicio,
      checkoutFecha: dto.fechaFin,
      noches: pricing.nights,
      checkinHabilitadoDesde: `${dto.fechaInicio}T14:00:00-05:00`,
      earlyCheckinAutorizado: false,
      cotizacionId: dto.cotizacionId,
      huespedTitular: guestWithDocument,
      desgloseFiscal: fiscalBreakdown,
      total: expectedTotal,
      currency: 'USD',
      politicaCancelacionAplicable: {
        esReembolsable: true,
        descripcion:
          typeof pricing.accommodation.politica_cancelacion === 'string'
            ? pricing.accommodation.politica_cancelacion
            : 'Cancelación gratuita hasta 48 horas antes del check-in.',
      },
      habitacionAsignada: null,
      claveAccesoDigital: null,
      planTarifaCodigo: dto.planTarifaCodigo ?? pricing.room.plan_tarifa_codigo,
      modeloPago: 'PREPAGO',
    };
    const order = {
      alojamiento_db_id: pricing.accommodation.id,
      alojamientoId: dto.alojamientoId,
      tipo_habitacion_id: pricing.room.id,
      tipoHabitacionCodigo: pricing.room.codigo,
      fechaInicio: dto.fechaInicio,
      fechaFin: dto.fechaFin,
      cantidadHabitaciones: dto.cantidadHabitaciones,
      ocupantes: dto.ocupantes,
      totalPagar: expectedTotal,
      cotizacionId: dto.cotizacionId,
      payment_method: dto.payment_method,
      payment_reference: dto.payment_reference,
      saga_id: dto.saga_id,
      ...(dto.paquete ? { paquete: dto.paquete } : {}),
      huespedesAdicionales: dto.huespedesAdicionales ?? [],
      peticionesEspeciales: dto.peticionesEspeciales,
      regimen: dto.regimenSeleccionado ?? pricing.room.regimen,
      planTarifaCodigo: dto.planTarifaCodigo ?? pricing.room.plan_tarifa_codigo,
      modeloPago: 'PREPAGO',
      huespedTitular: guestWithDocument,
      desgloseFiscal: fiscalBreakdown,
      external_order_id: externalOrderId,
      codigoReserva: reservationCode,
      response,
    };
    const requestForHash: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      requestForHash[key] = value;
    }
    requestForHash.huespedTitular = guestWithDocument;
    requestForHash.totalPagar = expectedTotal;
    const requestHash = this.hash(requestForHash);
    const { data, error } = await this.supabase.rpc(
      'create_alojamiento_order_v2',
      {
        p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
        p_order: order,
        p_correlation_id: correlationId,
      },
    );
    if (error) this.throwDatabaseError(error);
    if (!isRecord(data)) {
      throw new InternalServerErrorException(
        'La base de datos no devolvió la orden creada.',
      );
    }
    const { _idempotent_replayed: replayed, ...body } = data;
    return { body, replayed: replayed === true };
  }

  async cancel(
    orderRef: string,
    dto: IntegrationCancelOrderDto,
    idempotencyKey: string | undefined,
    correlationId: string,
  ) {
    this.validateIdempotencyKey(idempotencyKey);
    const requestHash = this.hash({
      orderRef,
      solicitadoPor: dto.solicitadoPor,
      motivo: dto.motivo ?? null,
    });
    const { data, error } = await this.supabase.rpc(
      'cancel_alojamiento_order_v2',
      {
        p_idempotency_key: idempotencyKey,
        p_request_hash: requestHash,
        p_order_ref: orderRef,
        p_requested_by: dto.solicitadoPor,
        p_correlation_id: correlationId,
      },
    );
    if (error) this.throwDatabaseError(error);
    if (!isRecord(data)) {
      throw new InternalServerErrorException(
        'La base de datos no devolvió la cancelación.',
      );
    }
    const { _idempotent_replayed: replayed, ...body } = data;
    return { body, replayed: replayed === true };
  }

  private normalizeGuest(dto: IntegrationOrderCreateDto): Guest {
    if (dto.huespedTitular) return dto.huespedTitular;
    if (dto.customer_contact) {
      return {
        nombreCompleto: dto.customer_contact.full_name,
        tipoDocumento: dto.customer_contact.document_type,
        identificacion: dto.customer_contact.document_id,
        email: dto.customer_contact.email,
        telefono: dto.customer_contact.phone,
      };
    }
    throw new UnprocessableEntityException({
      code: 'VALIDATION_FAILED',
      detail: 'Se requiere huespedTitular o customer_contact.',
    });
  }

  private validDocument(guest: Guest): boolean {
    if (guest.tipoDocumento === 'PASAPORTE') {
      return /^[A-Z0-9]{6,12}$/.test(guest.identificacion);
    }
    if (guest.tipoDocumento === 'RUC') {
      return this.validEcuadorianRuc(guest.identificacion);
    }
    return this.validEcuadorianId(guest.identificacion);
  }

  private validEcuadorianRuc(value: string): boolean {
    if (!/^[0-9]{13}$/.test(value)) return false;
    const province = Number(value.slice(0, 2));
    const thirdDigit = Number(value[2]);
    if (province < 1 || province > 24) return false;
    if (thirdDigit <= 5) {
      return (
        value.endsWith('001') && this.validEcuadorianId(value.slice(0, 10))
      );
    }
    if (thirdDigit === 9) {
      return (
        value.endsWith('001') &&
        this.validMod11(value, 9, [4, 3, 2, 7, 6, 5, 4, 3, 2])
      );
    }
    if (thirdDigit === 6) {
      return (
        value.endsWith('0001') &&
        this.validMod11(value, 8, [3, 2, 7, 6, 5, 4, 3, 2])
      );
    }
    return false;
  }

  private validMod11(
    value: string,
    digits: number,
    weights: number[],
  ): boolean {
    const sum = value
      .slice(0, digits)
      .split('')
      .reduce(
        (total, digit, index) => total + Number(digit) * weights[index],
        0,
      );
    const check = 11 - (sum % 11);
    return (
      (check === 11 ? 0 : check === 10 ? -1 : check) === Number(value[digits])
    );
  }

  private validEcuadorianId(value: string): boolean {
    if (!/^[0-9]{10}$/.test(value)) return false;
    const province = Number(value.slice(0, 2));
    if (province < 1 || province > 24 || Number(value[2]) > 5) return false;
    const sum = value
      .slice(0, 9)
      .split('')
      .reduce((total, digit, index) => {
        const number = Number(digit);
        const weighted = index % 2 === 0 ? number * 2 : number;
        return total + (weighted > 9 ? weighted - 9 : weighted);
      }, 0);
    return (10 - (sum % 10)) % 10 === Number(value[9]);
  }

  private validatePackage(
    dto: IntegrationOrderCreateDto,
    accommodation: DatabaseRow,
    subtotal: string,
  ): number {
    if (!dto.paquete) return 0;
    if (!accommodation.permite_paquete) {
      throw new UnprocessableEntityException({
        code: 'PROMOTIONS_NOT_ALLOWED',
        detail: 'Este alojamiento no acepta descuentos de paquetes.',
      });
    }
    if (
      dto.paquete.descuentoPorcentaje >
      Number(accommodation.descuento_maximo ?? 0)
    ) {
      throw new UnprocessableEntityException({
        code: 'DISCOUNT_EXCEEDS_CONTRACT',
        detail: 'El descuento excede el máximo acordado.',
      });
    }
    const expectedDiscount = Math.round(
      (this.cents(subtotal) * dto.paquete.descuentoPorcentaje) / 100,
    );
    if (this.cents(dto.paquete.descuentoMonto) !== expectedDiscount) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'descuentoMonto no coincide con el porcentaje del paquete.',
      });
    }
    return expectedDiscount;
  }

  private validateIdempotencyKey(
    key: string | undefined,
  ): asserts key is string {
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    ) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'La cabecera Idempotency-Key debe ser un UUID v4.',
      });
    }
  }

  private hash(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(sortObject(value)))
      .digest('hex');
  }

  private cents(value: string): number {
    const match = /^(\d+)\.(\d{2})$/.exec(value);
    if (!match) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'Los importes deben ser decimales con dos posiciones.',
      });
    }
    return Number(match[1]) * 100 + Number(match[2]);
  }

  private formatCents(value: number): string {
    return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
  }

  private throwDatabaseError(error: {
    code?: string;
    message?: string;
  }): never {
    const message = error.message ?? '';
    const code = message.match(
      /OUT_OF_STOCK|QUOTE_EXPIRED|QUOTE_NOT_FOUND|PRICE_MISMATCH|RESTRICTION_VIOLATED|VALIDATION_FAILED|CAPACITY_EXCEEDED|PROMOTIONS_NOT_ALLOWED|DISCOUNT_EXCEEDS_CONTRACT|IDEMPOTENCY_KEY_REUSED|IDEMPOTENCY_IN_PROGRESS|INVALID_STATE_TRANSITION|ORDER_NOT_FOUND|ROOM_NOT_FOUND/,
    )?.[0];
    if (code === 'OUT_OF_STOCK' || code === 'IDEMPOTENCY_IN_PROGRESS') {
      throw new ConflictException({ code, detail: message });
    }
    if (code === 'QUOTE_EXPIRED' || code === 'PRICE_MISMATCH') {
      throw new ConflictException({ code, detail: message });
    }
    if (code === 'INVALID_STATE_TRANSITION') {
      throw new ConflictException({ code, detail: message });
    }
    if (code === 'IDEMPOTENCY_KEY_REUSED') {
      throw new UnprocessableEntityException({ code, detail: message });
    }
    if (
      code === 'ORDER_NOT_FOUND' ||
      code === 'ROOM_NOT_FOUND' ||
      code === 'QUOTE_NOT_FOUND'
    ) {
      throw new NotFoundException({ code: 'NOT_FOUND', detail: message });
    }
    if (
      code === 'RESTRICTION_VIOLATED' ||
      code === 'VALIDATION_FAILED' ||
      code === 'CAPACITY_EXCEEDED' ||
      code === 'PROMOTIONS_NOT_ALLOWED' ||
      code === 'DISCOUNT_EXCEEDS_CONTRACT'
    ) {
      throw new UnprocessableEntityException({ code, detail: message });
    }
    throw new InternalServerErrorException(
      `No se pudo completar la operación de integración (${error.code ?? 'error de base de datos'}).`,
    );
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObject(value[key])]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
