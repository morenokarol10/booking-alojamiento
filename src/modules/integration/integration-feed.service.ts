import {
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
  IntegrationEventFeedQueryDto,
  IntegrationInventoryQueryDto,
} from './integration-feed.dto';

type DatabaseRow = Record<string, unknown>;

@Injectable()
export class IntegrationFeedService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async events(query: IntegrationEventFeedQueryDto) {
    let request = this.supabase
      .from('integracion_outbox')
      .select('id,sequence,type,occurred_at,subject,correlation_id,data', {
        count: 'exact',
      })
      .gt('sequence', query.after)
      .order('sequence', { ascending: true })
      .limit(query.limit + 1);
    if (query.type) request = request.eq('type', query.type);
    const { data, error, count } = await request;
    if (error) {
      throw new InternalServerErrorException(
        'No se pudieron consultar los eventos de integración.',
      );
    }

    const rows = (data ?? []) as DatabaseRow[];
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit);
    const events = selected.map((row) => ({
      id: String(row.id),
      source: '/services/alojamientos',
      specversion: '1.0',
      type: String(row.type),
      time: String(row.occurred_at),
      sequence: Number(row.sequence),
      subject: String(row.subject),
      ...(typeof row.correlation_id === 'string'
        ? { correlationid: row.correlation_id }
        : {}),
      datacontenttype: 'application/json',
      data: row.data,
    }));
    return {
      eventos: events,
      has_more: hasMore,
      next_after:
        selected.length > 0
          ? Number(selected[selected.length - 1].sequence)
          : query.after,
      total_results: count ?? events.length,
      request_id: randomUUID(),
    };
  }

  async inventory(
    accommodationCode: string,
    query: IntegrationInventoryQueryDto,
  ) {
    const rangeDays =
      (Date.parse(`${query.hasta}T00:00:00Z`) -
        Date.parse(`${query.desde}T00:00:00Z`)) /
      86_400_000;
    if (!Number.isInteger(rangeDays) || rangeDays < 0 || rangeDays > 91) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'El rango de inventario debe ser de 1 a 92 días.',
      });
    }
    const { data: accommodation, error: accommodationError } =
      await this.supabase
        .from('alojamientos')
        .select('id,codigo_integracion')
        .eq('codigo_integracion', accommodationCode)
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

    let roomRequest = this.supabase
      .from('tipos_habitacion')
      .select(
        'id,codigo,habitaciones_totales,precio_base_noche,plan_tarifa_codigo,activo',
      )
      .eq('alojamiento_id', accommodation.id)
      .eq('activo', true)
      .order('codigo', { ascending: true });
    if (query.tipoHabitacion) {
      roomRequest = roomRequest.eq('codigo', query.tipoHabitacion);
    }
    const { data: rooms, error: roomError } = await roomRequest;
    if (roomError) {
      throw new InternalServerErrorException(
        'No se pudieron consultar las habitaciones.',
      );
    }
    if (query.tipoHabitacion && !rooms?.length) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        detail: 'No se encontró el tipo de habitación solicitado.',
      });
    }

    const roomIds = (rooms ?? []).map((room) => String(room.id));
    const [inventoryResult, reservationsResult] =
      roomIds.length > 0
        ? await Promise.all([
            this.supabase
              .from('inventario_diario')
              .select(
                'tipo_habitacion_id,fecha,habitaciones_totales,habitaciones_bloqueadas,precio_noche,venta_cerrada,cerrado_a_llegada,cerrado_a_salida,estancia_minima,estancia_maxima,anticipacion_minima_horas',
              )
              .in('tipo_habitacion_id', roomIds)
              .gte('fecha', query.desde)
              .lte('fecha', query.hasta),
            this.supabase
              .from('reservas')
              .select(
                'tipo_habitacion_id,fecha_checkin,fecha_checkout,cantidad_habitaciones',
              )
              .in('tipo_habitacion_id', roomIds)
              .lte('fecha_checkin', query.hasta)
              .gt('fecha_checkout', query.desde)
              .neq('estado_integracion', 'CANCELLED'),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
          ];
    if (inventoryResult.error || reservationsResult.error) {
      throw new InternalServerErrorException(
        'No se pudo consultar el inventario diario.',
      );
    }

    const inventoryRows = (inventoryResult.data ?? []) as DatabaseRow[];
    const reservationRows = (reservationsResult.data ?? []) as DatabaseRow[];
    const inventoryByDate = new Map(
      inventoryRows.map((row) => [
        `${String(row.tipo_habitacion_id)}:${String(row.fecha)}`,
        row,
      ]),
    );
    const reservationsByRoomDate = new Map<string, number>();
    for (const reservation of reservationRows) {
      const firstDate =
        String(reservation.fecha_checkin) > query.desde
          ? String(reservation.fecha_checkin)
          : query.desde;
      const finalDate =
        String(reservation.fecha_checkout) < this.addDays(query.hasta, 1)
          ? String(reservation.fecha_checkout)
          : this.addDays(query.hasta, 1);
      for (
        let date = firstDate;
        date < finalDate;
        date = this.addDays(date, 1)
      ) {
        const key = `${String(reservation.tipo_habitacion_id)}:${date}`;
        reservationsByRoomDate.set(
          key,
          (reservationsByRoomDate.get(key) ?? 0) +
            Number(reservation.cantidad_habitaciones),
        );
      }
    }
    const nights = [];
    for (const room of rooms ?? []) {
      for (let offset = 0; offset <= rangeDays; offset += 1) {
        const date = this.addDays(query.desde, offset);
        const roomId = String(room.id);
        const item = inventoryByDate.get(`${roomId}:${date}`);
        const total = Number(
          item?.habitaciones_totales ?? room.habitaciones_totales,
        );
        const blocked = Number(item?.habitaciones_bloqueadas ?? 0);
        const reserved = reservationsByRoomDate.get(`${roomId}:${date}`) ?? 0;
        const ventaCerrada = Boolean(item?.venta_cerrada ?? false);
        const tarifa = {
          planTarifaCodigo: String(room.plan_tarifa_codigo),
          precioNoche: this.money(
            String(item?.precio_noche ?? room.precio_base_noche),
          ),
          restricciones: {
            estanciaMinima: Number(item?.estancia_minima ?? 1),
            estanciaMaxima: Number(item?.estancia_maxima ?? 30),
            cerradoALlegada: Boolean(item?.cerrado_a_llegada ?? false),
            cerradoASalida: Boolean(item?.cerrado_a_salida ?? false),
            ventaCerrada,
            anticipacionMinimaHoras: Number(
              item?.anticipacion_minima_horas ?? 0,
            ),
          },
        };
        nights.push({
          fecha: date,
          tipoHabitacionCodigo: String(room.codigo),
          habitacionesTotales: total,
          reservadas: reserved,
          bloqueadas: blocked,
          disponibles: ventaCerrada
            ? 0
            : Math.max(total - reserved - blocked, 0),
          tarifas: [tarifa],
        });
      }
    }

    const hash = createHash('sha256')
      .update(JSON.stringify(nights))
      .digest('hex');
    return {
      alojamientoId: accommodationCode,
      desde: query.desde,
      hasta: query.hasta,
      generadoEn: new Date().toISOString(),
      hash,
      noches: nights,
    };
  }

  private addDays(date: string, days: number): string {
    const result = new Date(`${date}T00:00:00Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
  }

  private money(value: string): string {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
      throw new InternalServerErrorException(
        'La base de datos contiene una tarifa inválida.',
      );
    }
    const [units, fraction = ''] = value.split('.');
    return `${units}.${fraction.padEnd(2, '0')}`;
  }
}
