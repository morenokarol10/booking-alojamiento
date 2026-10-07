import type { SupabaseClient } from '@supabase/supabase-js';
import { ReservationsService } from './reservations.service';

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

class QueryMock {
  constructor(
    private result: QueryResult,
    private readonly onInsert: (value: unknown) => QueryResult,
  ) {}

  select(): this {
    return this;
  }

  eq(): this {
    return this;
  }

  neq(): this {
    return this;
  }

  lt(): this {
    return this;
  }

  gt(): Promise<QueryResult> {
    return Promise.resolve(this.result);
  }

  insert(value: unknown): this {
    this.result = this.onInsert(value);
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    return Promise.resolve(this.result);
  }

  single(): Promise<QueryResult> {
    return Promise.resolve(this.result);
  }
}

describe('ReservationsService payment and event flow', () => {
  it('confirms simulated payment, persists camelCase request as snake_case, and writes the event', async () => {
    const inserts: Record<string, unknown[]> = {
      reservas: [],
      eventos_log: [],
    };
    let reservationsQueryCount = 0;
    const accommodation = {
      id: '10000000-0000-4000-8000-000000000001',
      precio_base_noche: 85,
      moneda: 'USD',
      capacidad_maxima: 4,
      habitaciones_disponibles: 1,
    };
    const reservationQueryResult: QueryResult = {
      data: {
        id: '40000000-0000-4000-8000-000000000001',
        alojamiento_id: accommodation.id,
        cliente_nombre: 'María Pérez',
        cliente_email: 'maria@example.com',
        cliente_telefono: '+593991234567',
        fecha_checkin: '2026-11-10',
        fecha_checkout: '2026-11-13',
        num_huespedes: 2,
        precio_total: 255,
        moneda: 'USD',
        metodo_pago_simulado: 'tarjeta',
        pago_estado: 'exitoso',
        pago_referencia: '30000000-0000-4000-8000-000000000001',
        estado: 'confirmada',
        created_at: '2026-10-07T00:00:00.000Z',
      },
      error: null,
    };
    const supabaseStub = {
      from: (table: string) => {
        if (table === 'alojamientos') {
          return new QueryMock({ data: accommodation, error: null }, () => ({
            data: null,
            error: null,
          }));
        }
        if (table === 'reservas') {
          reservationsQueryCount += 1;
          if (reservationsQueryCount === 1) {
            return new QueryMock({ data: [], error: null }, () => ({
              data: null,
              error: null,
            }));
          }
          return new QueryMock(reservationQueryResult, (value) => {
            inserts.reservas.push(value);
            return reservationQueryResult;
          });
        }
        if (table === 'eventos_log') {
          return {
            insert: (value: unknown) => {
              inserts.eventos_log.push(value);
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        throw new Error(`Unexpected Supabase table: ${table}`);
      },
    } as unknown as SupabaseClient;
    const service = new ReservationsService(supabaseStub);

    const response = await service.create(
      {
        alojamientoId: accommodation.id,
        clienteNombre: 'María Pérez',
        clienteEmail: 'maria@example.com',
        clienteTelefono: '+593991234567',
        fechaCheckin: '2026-11-10',
        fechaCheckout: '2026-11-13',
        numHuespedes: 2,
        metodoPagoSimulado: 'tarjeta',
      },
      {
        id: '50000000-0000-4000-8000-000000000001',
        email: 'maria@example.com',
        role: 'cliente',
      },
    );

    expect(inserts.reservas[0]).toMatchObject({
      alojamiento_id: accommodation.id,
      cliente_id: '50000000-0000-4000-8000-000000000001',
      cliente_nombre: 'María Pérez',
      fecha_checkin: '2026-11-10',
      fecha_checkout: '2026-11-13',
      num_huespedes: 2,
      precio_total: 255,
      metodo_pago_simulado: 'tarjeta',
      pago_estado: 'exitoso',
      estado: 'confirmada',
    });
    expect(inserts.eventos_log[0]).toMatchObject({
      tipo_evento: 'ReservaRealizadaEvent',
      payload: {
        eventType: 'ReservaRealizadaEvent',
        data: {
          alojamientoId: accommodation.id,
          clienteNombre: 'María Pérez',
          precioTotal: 255,
          pagoEstado: 'exitoso',
        },
      },
    });
    expect(response).toMatchObject({
      data: {
        alojamientoId: accommodation.id,
        clienteNombre: 'María Pérez',
        precioTotal: 255,
        pagoEstado: 'exitoso',
        estado: 'confirmada',
      },
      pago: { estado: 'exitoso', simulado: true },
    });
  });
});
