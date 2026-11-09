import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';
import {
  IntegrationAvailabilityDto,
  IntegrationCatalogQueryDto,
  IntegrationSearchDto,
} from './integration-catalog.dto';

type DatabaseRow = Record<string, unknown>;

@Injectable()
export class IntegrationCatalogService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async list(query: IntegrationCatalogQueryDto) {
    let request = this.supabase
      .from('alojamientos')
      .select(
        'id,codigo_integracion,nombre,tipo,ciudad,direccion,estrellas,score_calificacion,total_resenas,precio_base_noche,moneda,permite_paquete,descuento_maximo,servicios,urls_imagenes,updated_at,habitaciones_disponibles',
        { count: 'exact' },
      )
      .order('updated_at', { ascending: false });

    if (query.ciudad) request = request.ilike('ciudad', `%${query.ciudad}%`);
    if (query.estrellas !== undefined) {
      request = request.eq('estrellas', query.estrellas);
    }
    if (query.minPrecio)
      request = request.gte('precio_base_noche', query.minPrecio);
    if (query.maxPrecio)
      request = request.lte('precio_base_noche', query.maxPrecio);
    if (query.permitePaquete !== undefined) {
      request = request.eq('permite_paquete', query.permitePaquete);
    }
    if (query.actualizadoDesde) {
      request = request.gte('updated_at', query.actualizadoDesde);
    }
    const from = (query.page - 1) * query.limit;
    const { data, error, count } = await request.range(
      from,
      from + query.limit - 1,
    );
    if (error) {
      throw new InternalServerErrorException(
        'No se pudo consultar el catálogo de alojamientos.',
      );
    }

    if (
      query.minPrecio &&
      query.maxPrecio &&
      this.toCents(query.minPrecio) > this.toCents(query.maxPrecio)
    ) {
      throw new BadRequestException(
        'minPrecio no puede ser mayor que maxPrecio.',
      );
    }
    const items = (data ?? []).map((row) => this.toCard(row));
    const total = count ?? 0;
    const body = {
      metadata: this.metadata(total, query.page, query.limit),
      data: items,
    };
    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('hex')}"`;
    return { body, etag };
  }

  async search(request: IntegrationSearchDto) {
    const nights = this.nights(request.fechaInicio, request.fechaFin);
    if (request.edadesNinos && request.edadesNinos.length !== request.ninos) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'edadesNinos debe contener una edad por cada niño.',
      });
    }
    let query = this.supabase
      .from('alojamientos')
      .select(
        'id,codigo_integracion,nombre,tipo,ciudad,direccion,estrellas,score_calificacion,total_resenas,precio_base_noche,moneda,permite_paquete,descuento_maximo,servicios,urls_imagenes,updated_at,habitaciones_disponibles,capacidad_maxima,iva_porcentaje,tasa_municipal_por_noche',
        { count: 'exact' },
      )
      .ilike('ciudad', `%${this.escapeLike(request.destino)}%`)
      .order('precio_base_noche', { ascending: true });

    if (request.estrellasMinimas !== undefined) {
      query = query.gte('estrellas', request.estrellasMinimas);
    }
    if (request.permitePaquete !== undefined) {
      query = query.eq('permite_paquete', request.permitePaquete);
    }
    if (request.currency && request.currency !== 'USD') {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_CURRENCY',
        detail: 'Este nodo solo cotiza en USD.',
      });
    }

    const from = (request.page - 1) * request.limit;
    const batchSize = 100;
    const availableProperties: Array<{
      row: DatabaseRow;
      room: DatabaseRow;
      priceTotal?: string;
    }> = [];
    const maximumPrice =
      request.precioMaximo === undefined
        ? undefined
        : this.toCents(request.precioMaximo);
    let candidateOffset = 0;
    let totalCandidates = 0;
    while (true) {
      const { data, error, count } = await query.range(
        candidateOffset,
        candidateOffset + batchSize - 1,
      );
      if (error) {
        throw new InternalServerErrorException(
          'No se pudo buscar alojamientos.',
        );
      }
      totalCandidates = count ?? totalCandidates;
      const eligible = (data ?? []).filter((row) => {
        const amenities = Array.isArray(row.servicios) ? row.servicios : [];
        return (request.amenidadesDeseadas ?? []).every((amenity) =>
          amenities.some(
            (value) =>
              typeof value === 'string' &&
              value.toLocaleLowerCase() === amenity.toLocaleLowerCase(),
          ),
        );
      });
      const resultIds = eligible.map((row) => String(row.id));
      const { data: rooms, error: roomsError } = resultIds.length
        ? await this.supabase
            .from('tipos_habitacion')
            .select(
              'id,alojamiento_id,codigo,capacidad_maxima,habitaciones_totales,precio_base_noche,regimen,activo',
            )
            .in('alojamiento_id', resultIds)
            .eq('activo', true)
        : { data: [], error: null };
      if (roomsError) {
        throw new InternalServerErrorException(
          'No se pudieron consultar los tipos de habitación.',
        );
      }

      for (const row of eligible) {
        const matchingRooms = (rooms ?? [])
          .filter(
            (room) =>
              room.alojamiento_id === row.id &&
              Number(room.capacidad_maxima) * request.habitaciones >=
                request.adultos + request.ninos &&
              (!request.regimen || room.regimen === request.regimen),
          )
          .sort(
            (left, right) =>
              Number(left.precio_base_noche) - Number(right.precio_base_noche),
          );
        for (const room of matchingRooms) {
          const { error: restrictionsError } = await this.supabase.rpc(
            'alojamientos_v2_validar_restricciones',
            {
              p_tipo_habitacion_id: room.id,
              p_fecha_inicio: request.fechaInicio,
              p_fecha_fin: request.fechaFin,
            },
          );
          if (restrictionsError) {
            if (restrictionsError.message.includes('RESTRICTION_VIOLATED')) {
              continue;
            }
            throw new InternalServerErrorException(
              'No se pudieron validar las restricciones de búsqueda.',
            );
          }

          const { data: availability, error: availabilityError } =
            await this.supabase.rpc('alojamientos_v2_disponibilidad', {
              p_tipo_habitacion_id: room.id,
              p_fecha_inicio: request.fechaInicio,
              p_fecha_fin: request.fechaFin,
            });
          if (availabilityError) {
            throw new InternalServerErrorException(
              'No se pudo validar la disponibilidad de búsqueda.',
            );
          }
          const remaining = Number(
            (availability?.[0] as DatabaseRow | undefined)
              ?.habitaciones_remanentes ?? 0,
          );
          if (remaining >= request.habitaciones) {
            let priceTotal: string | undefined;
            if (maximumPrice !== undefined) {
              priceTotal = (
                await this.priceBreakdown(
                  room,
                  request.fechaInicio,
                  request.fechaFin,
                  request.habitaciones,
                  Number(row.iva_porcentaje ?? 15),
                  this.numericString(
                    row.tasa_municipal_por_noche,
                    '0.00',
                    'La base de datos contiene una tasa municipal inválida.',
                  ),
                )
              ).totalPagar;
              if (this.toCents(priceTotal) > maximumPrice) continue;
            }
            availableProperties.push({ row, room, priceTotal });
            break;
          }
        }
      }

      const rowsFetched = data?.length ?? 0;
      candidateOffset += rowsFetched;
      if (
        rowsFetched < batchSize ||
        (totalCandidates > 0 && candidateOffset >= totalCandidates)
      ) {
        break;
      }
    }

    const matching = availableProperties.slice(from, from + request.limit);
    const results = await Promise.all(
      matching.map(async ({ row, room, priceTotal }) => ({
        ...this.toCard(row),
        precioTotalEstancia:
          priceTotal ??
          (
            await this.priceBreakdown(
              room,
              request.fechaInicio,
              request.fechaFin,
              request.habitaciones,
              Number(row.iva_porcentaje ?? 15),
              this.numericString(
                row.tasa_municipal_por_noche,
                '0.00',
                'La base de datos contiene una tasa municipal inválida.',
              ),
            )
          ).totalPagar,
      })),
    );

    return {
      request_id: randomUUID(),
      metadata: {
        ...this.metadata(
          availableProperties.length,
          request.page,
          request.limit,
        ),
        destino: request.destino,
        noches: nights,
      },
      data: results,
      alojamientos: results,
    };
  }

  async pricingForOrder(input: {
    accommodationCode: string;
    roomCode: string;
    start: string;
    end: string;
    quantity: number;
    planCode?: string;
  }) {
    const nights = this.nights(input.start, input.end);
    const { data: accommodation, error: accommodationError } =
      await this.supabase
        .from('alojamientos')
        .select(
          'id,codigo_integracion,nombre,politica_cancelacion,iva_porcentaje,tasa_municipal_por_noche,permite_paquete,descuento_maximo',
        )
        .eq('codigo_integracion', input.accommodationCode)
        .maybeSingle();
    if (accommodationError) {
      throw new InternalServerErrorException(
        'No se pudo consultar el alojamiento.',
      );
    }
    if (!accommodation) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        detail: 'No se encontró el alojamiento solicitado.',
      });
    }
    const { data: room, error: roomError } = await this.supabase
      .from('tipos_habitacion')
      .select(
        'id,codigo,nombre,capacidad_maxima,habitaciones_totales,precio_base_noche,moneda,plan_tarifa_codigo,regimen',
      )
      .eq('alojamiento_id', accommodation.id)
      .eq('codigo', input.roomCode)
      .eq('activo', true)
      .maybeSingle();
    if (roomError) {
      throw new InternalServerErrorException(
        'No se pudo consultar el tipo de habitación.',
      );
    }
    if (!room) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        detail: 'No se encontró el tipo de habitación solicitado.',
      });
    }
    if (input.planCode && input.planCode !== room.plan_tarifa_codigo) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        detail: 'No se encontró el plan tarifario solicitado.',
      });
    }
    return {
      nights,
      accommodation,
      room,
      breakdown: await this.priceBreakdown(
        room,
        input.start,
        input.end,
        input.quantity,
        Number(accommodation.iva_porcentaje ?? 15),
        String(accommodation.tasa_municipal_por_noche ?? '0.00'),
      ),
    };
  }

  async quote(dto: IntegrationAvailabilityDto) {
    const nights = this.nights(dto.fechaInicio, dto.fechaFin);
    if (dto.currency && dto.currency !== 'USD') {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_CURRENCY',
        detail: 'Este nodo solo cotiza en USD.',
      });
    }
    const { data: accommodation, error: accommodationError } =
      await this.supabase
        .from('alojamientos')
        .select(
          'id,codigo_integracion,nombre,politica_cancelacion,iva_porcentaje,tasa_municipal_por_noche',
        )
        .eq('codigo_integracion', dto.alojamientoId)
        .maybeSingle();
    if (accommodationError) {
      throw new InternalServerErrorException(
        'No se pudo consultar el alojamiento.',
      );
    }
    if (!accommodation) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        detail: 'No se encontró el alojamiento solicitado.',
      });
    }

    const { data: room, error: roomError } = await this.supabase
      .from('tipos_habitacion')
      .select(
        'id,codigo,nombre,capacidad_maxima,habitaciones_totales,precio_base_noche,moneda,plan_tarifa_codigo,regimen',
      )
      .eq('alojamiento_id', accommodation.id)
      .eq('codigo', dto.tipoHabitacionCodigo)
      .eq('activo', true)
      .maybeSingle();
    if (roomError) {
      throw new InternalServerErrorException(
        'No se pudo consultar el tipo de habitación.',
      );
    }
    if (!room) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        detail: 'No se encontró el tipo de habitación solicitado.',
      });
    }
    if (
      dto.planTarifaCodigo &&
      dto.planTarifaCodigo !== room.plan_tarifa_codigo
    ) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        detail: 'No se encontró el plan tarifario solicitado.',
      });
    }
    if (
      dto.ocupantes &&
      dto.ocupantes.adultos + dto.ocupantes.ninos >
        Number(room.capacidad_maxima) * dto.cantidadHabitaciones
    ) {
      throw new UnprocessableEntityException({
        code: 'CAPACITY_EXCEEDED',
        detail: 'La ocupación excede la capacidad del tipo de habitación.',
      });
    }

    const { error: restrictionsError } = await this.supabase.rpc(
      'alojamientos_v2_validar_restricciones',
      {
        p_tipo_habitacion_id: room.id,
        p_fecha_inicio: dto.fechaInicio,
        p_fecha_fin: dto.fechaFin,
      },
    );
    if (restrictionsError) {
      if (restrictionsError.message.includes('ROOM_NOT_FOUND')) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          detail: 'No se encontró el tipo de habitación solicitado.',
        });
      }
      if (restrictionsError.message.includes('RESTRICTION_VIOLATED')) {
        throw new UnprocessableEntityException({
          code: 'RESTRICTION_VIOLATED',
          detail: 'La estancia incumple las restricciones de la tarifa.',
        });
      }
      throw new InternalServerErrorException(
        'No se pudieron validar las restricciones de la tarifa.',
      );
    }

    const { data: availability, error: availabilityError } =
      await this.supabase.rpc('alojamientos_v2_disponibilidad', {
        p_tipo_habitacion_id: room.id,
        p_fecha_inicio: dto.fechaInicio,
        p_fecha_fin: dto.fechaFin,
      });
    if (availabilityError) {
      throw new InternalServerErrorException(
        'No se pudo consultar la disponibilidad.',
      );
    }

    const remaining = Number(
      (availability?.[0] as DatabaseRow | undefined)?.habitaciones_remanentes ??
        0,
    );
    const available = remaining >= dto.cantidadHabitaciones;
    if (!available) {
      throw new ConflictException({
        code: 'OUT_OF_STOCK',
        detail: 'No hay habitaciones suficientes para las fechas solicitadas.',
      });
    }
    const breakdown = await this.priceBreakdown(
      room,
      dto.fechaInicio,
      dto.fechaFin,
      dto.cantidadHabitaciones,
      Number(accommodation.iva_porcentaje ?? 15),
      String(accommodation.tasa_municipal_por_noche ?? '0.00'),
    );
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { data: quote, error: quoteError } = await this.supabase
      .from('cotizaciones_alojamiento')
      .insert({
        alojamiento_id: accommodation.id,
        tipo_habitacion_id: room.id,
        fecha_inicio: dto.fechaInicio,
        fecha_fin: dto.fechaFin,
        cantidad_habitaciones: dto.cantidadHabitaciones,
        currency: 'USD',
        total_pagar: breakdown.totalPagar,
        desglose: breakdown,
        valido_hasta: expiresAt,
      })
      .select('id')
      .single();
    if (quoteError || !quote) {
      throw new InternalServerErrorException(
        'No se pudo guardar la cotización.',
      );
    }

    return {
      alojamientoId: dto.alojamientoId,
      tipoHabitacionCodigo: room.codigo,
      estaDisponible: available,
      habitacionesRemanentes: remaining,
      nochesEstancia: nights,
      desglosePrecio: breakdown,
      precioTotalCotizado: breakdown.totalPagar,
      cotizacionId: quote.id,
      tarifaValidaHasta: expiresAt,
      currency: 'USD',
      planTarifaCodigo: dto.planTarifaCodigo ?? room.plan_tarifa_codigo,
      politicaCancelacion: {
        esReembolsable: true,
        horasLimiteCancelacion: 48,
        penalidadFueraDeVentanaPorcentaje: 100,
        descripcion:
          typeof accommodation.politica_cancelacion === 'string'
            ? accommodation.politica_cancelacion
            : 'Cancelación gratuita hasta 48 horas antes del check-in.',
      },
    };
  }

  private toCard(row: DatabaseRow) {
    const typeMap: Record<string, string> = {
      hotel: 'HOTEL',
      departamento: 'APARTAMENTO',
      villa: 'RESORT',
    };
    return {
      id: String(row.codigo_integracion),
      nombre: String(row.nombre),
      tipoPropiedad: typeMap[String(row.tipo)] ?? 'HOTEL',
      destino: String(row.ciudad),
      direccion: String(row.direccion),
      estrellas: Number(row.estrellas),
      ...(row.score_calificacion !== null &&
      row.score_calificacion !== undefined
        ? { scoreCalificacion: Number(row.score_calificacion) }
        : {}),
      totalResenas: Number(row.total_resenas ?? 0),
      precioPorNoche: this.money(String(row.precio_base_noche)),
      moneda: String(row.moneda),
      permitePaquete: Boolean(row.permite_paquete),
      descuentoMaximo: Number(row.descuento_maximo ?? 0),
      checkInPermitidoDesde: '14:00',
      checkOutHoraMaxima: '11:00',
      fotos: Array.isArray(row.urls_imagenes) ? row.urls_imagenes : [],
      amenidades: Array.isArray(row.servicios) ? row.servicios : [],
      actualizadoEn: String(row.updated_at),
    };
  }

  private async priceBreakdown(
    room: DatabaseRow,
    start: string,
    end: string,
    quantity: number,
    ivaPercent: number,
    municipalTax: string,
  ) {
    const nightCount = this.nights(start, end);
    const { data: nightRates, error } = await this.supabase
      .from('inventario_diario')
      .select('fecha,precio_noche')
      .eq('tipo_habitacion_id', room.id)
      .gte('fecha', start)
      .lt('fecha', end);
    if (error) {
      throw new InternalServerErrorException(
        'No se pudieron consultar las tarifas por noche.',
      );
    }

    const ratesByDate = new Map(
      (nightRates ?? [])
        .filter(
          (rate) =>
            rate.precio_noche !== null && rate.precio_noche !== undefined,
        )
        .map((rate) => [rate.fecha, String(rate.precio_noche)]),
    );
    const baseCents = this.toCents(String(room.precio_base_noche));
    const nightsDetail = Array.from({ length: nightCount }, (_, index) => {
      const date = this.addDays(start, index);
      const rate = ratesByDate.get(date);
      const cents = rate ? this.toCents(rate) : baseCents;
      return { fecha: date, cents };
    });
    const subtotalCents =
      nightsDetail.reduce((sum, night) => sum + night.cents, 0) * quantity;
    const ivaCents = Math.round((subtotalCents * ivaPercent) / 100);
    const municipalCents = this.toCents(municipalTax) * nightCount * quantity;
    const totalCents = subtotalCents + ivaCents + municipalCents;

    return {
      precioNoche: this.money(this.fromCents(nightsDetail[0].cents)),
      subtotal: this.money(this.fromCents(subtotalCents)),
      ivaPorcentaje: ivaPercent,
      ivaValor: this.money(this.fromCents(ivaCents)),
      tasaMunicipal: this.money(this.fromCents(municipalCents)),
      descuentoCombo: '0.00',
      totalPagar: this.money(this.fromCents(totalCents)),
      nochesDetalle: nightsDetail.map((night) => ({
        fecha: night.fecha,
        precio: this.money(this.fromCents(night.cents * quantity)),
      })),
    };
  }

  private stayTotal(row: DatabaseRow, nights: number, rooms: number): string {
    const subtotal =
      this.toCents(String(row.precio_base_noche)) * nights * rooms;
    const iva = Math.round((subtotal * Number(row.iva_porcentaje ?? 15)) / 100);
    const municipalRate = row.tasa_municipal_por_noche ?? '0';
    if (
      typeof municipalRate !== 'string' &&
      typeof municipalRate !== 'number'
    ) {
      throw new InternalServerErrorException(
        'La base de datos contiene una tasa municipal inválida.',
      );
    }
    const municipal = this.toCents(String(municipalRate)) * nights * rooms;
    return this.money(this.fromCents(subtotal + iva + municipal));
  }

  private metadata(total: number, page: number, limit: number) {
    const pages = Math.ceil(total / limit);
    return {
      total_results: total,
      page,
      limit,
      total_pages: pages,
      has_next: page < pages,
    };
  }

  private nights(start: string, end: string): number {
    const startDate = Date.parse(`${start}T00:00:00Z`);
    const endDate = Date.parse(`${end}T00:00:00Z`);
    const count = (endDate - startDate) / 86_400_000;
    if (!Number.isInteger(count) || count < 1 || count > 30) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'Las fechas deben formar una estancia de 1 a 30 noches.',
      });
    }
    const todayInGuayaquil = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guayaquil',
    }).format(new Date());
    if (start < todayInGuayaquil) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'La fecha de llegada no puede ser anterior a hoy en Ecuador.',
      });
    }
    return count;
  }

  private addDays(date: string, days: number): string {
    const result = new Date(`${date}T00:00:00Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }

  private toCents(value: string): number {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
    if (!match) {
      throw new InternalServerErrorException(
        'La base de datos contiene una tarifa inválida.',
      );
    }
    return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  }

  private fromCents(cents: number): string {
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  }

  private money(value: string): string {
    return this.fromCents(this.toCents(value));
  }

  private numericString(
    value: unknown,
    fallback: string,
    errorMessage: string,
  ): string {
    if (value === null || value === undefined) return fallback;
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new InternalServerErrorException(errorMessage);
    }
    return String(value);
  }
}
