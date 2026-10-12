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

  order(): Promise<QueryResult> {
    return Promise.resolve(this.result);
  }

  insert(value: unknown): this {
    this.result = this.onInsert(value);
    return this;
  }

  update(value: unknown): this {
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
  it('requires contact details from the authenticated profile before reserving', async () => {
    const service = new ReservationsService({} as SupabaseClient);

    await expect(
      service.create(
        {
          alojamientoId: '10000000-0000-4000-8000-000000000001',
          fechaCheckin: '2026-11-10',
          fechaCheckout: '2026-11-13',
          numHuespedes: 2,
          metodoPagoSimulado: 'tarjeta',
        },
        {
          id: '50000000-0000-4000-8000-000000000001',
          email: 'maria@example.com',
          role: 'cliente',
          fullName: 'María Pérez',
        },
      ),
    ).rejects.toThrow(/nombre completo, correo y teléfono/i);
  });

  it.each([
    ['cliente_id', '20261011_booking_admin_schema.sql'],
    ['metodo_pago_simulado', '20261012_reservas_payment_method.sql'],
  ])(
    'explains how to repair Supabase when reservas.%s is missing',
    async (column, migration) => {
      const accommodation = {
        id: '10000000-0000-4000-8000-000000000001',
        precio_base_noche: 85,
        moneda: 'USD',
        capacidad_maxima: 4,
        habitaciones_disponibles: 1,
      };
      const missingColumnError = {
        code: 'PGRST204',
        message: `Could not find the '${column}' column of 'reservas' in the schema cache`,
      };
      let reservationQueryCount = 0;
      const supabaseStub = {
        from: (table: string) => {
          if (table === 'alojamientos') {
            return new QueryMock({ data: accommodation, error: null }, () => ({
              data: null,
              error: null,
            }));
          }
          reservationQueryCount += 1;
          if (reservationQueryCount === 1) {
            return new QueryMock({ data: [], error: null }, () => ({
              data: null,
              error: null,
            }));
          }
          return new QueryMock(
            { data: null, error: missingColumnError },
            () => ({ data: null, error: missingColumnError }),
          );
        },
      } as unknown as SupabaseClient;
      const service = new ReservationsService(supabaseStub);

      await expect(
        service.create(
          {
            alojamientoId: accommodation.id,
            fechaCheckin: '2026-11-10',
            fechaCheckout: '2026-11-13',
            numHuespedes: 2,
            metodoPagoSimulado: 'tarjeta',
          },
          {
            id: '50000000-0000-4000-8000-000000000001',
            email: 'maria@example.com',
            role: 'cliente',
            fullName: 'María Pérez',
            phone: '+593991234567',
          },
        ),
      ).rejects.toThrow(migration);
    },
  );

  it('supports multiple reservations and writes one EDA event per successful reservation', async () => {
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
        fechaCheckin: '2026-11-10',
        fechaCheckout: '2026-11-13',
        numHuespedes: 2,
        metodoPagoSimulado: 'tarjeta',
      },
      {
        id: '50000000-0000-4000-8000-000000000001',
        email: 'maria@example.com',
        role: 'cliente',
        fullName: 'María Pérez',
        phone: '+593991234567',
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

    await service.create(
      {
        alojamientoId: accommodation.id,
        fechaCheckin: '2026-12-10',
        fechaCheckout: '2026-12-12',
        numHuespedes: 2,
        metodoPagoSimulado: 'tarjeta',
      },
      {
        id: '50000000-0000-4000-8000-000000000001',
        email: 'maria@example.com',
        role: 'cliente',
        fullName: 'María Pérez',
        phone: '+593991234567',
      },
    );

    expect(inserts.reservas).toHaveLength(2);
    expect(inserts.eventos_log).toHaveLength(2);
  });

  it('returns only reservations associated with the authenticated customer', async () => {
    const customerId = '50000000-0000-4000-8000-000000000001';
    const filteredIds: string[] = [];
    const rows = [
      {
        id: '40000000-0000-4000-8000-000000000001',
        alojamiento_id: '10000000-0000-4000-8000-000000000001',
        cliente_id: customerId,
        cliente_nombre: 'María Pérez',
        cliente_email: 'maria@example.com',
        cliente_telefono: '+593991234567',
        fecha_checkin: '2026-11-10',
        fecha_checkout: '2026-11-13',
        num_huespedes: 2,
        precio_total: '255.00',
        moneda: 'USD',
        metodo_pago_simulado: 'tarjeta',
        pago_estado: 'exitoso',
        pago_referencia: '30000000-0000-4000-8000-000000000001',
        estado: 'confirmada',
        created_at: '2026-10-07T00:00:00.000Z',
        alojamientos: {
          id: '10000000-0000-4000-8000-000000000001',
          nombre: 'Suite Quito',
          ciudad: 'Quito',
        },
      },
    ];
    const supabaseStub = {
      from: (table: string) => {
        expect(table).toBe('reservas');
        return {
          select: () => ({
            eq: (column: string, value: string) => {
              expect(column).toBe('cliente_id');
              filteredIds.push(value);
              return {
                order: async () => ({ data: rows, error: null }),
              };
            },
          }),
        };
      },
    } as unknown as SupabaseClient;
    const service = new ReservationsService(supabaseStub);

    const response = await service.findMine({
      id: customerId,
      email: 'maria@example.com',
      role: 'cliente',
    });

    expect(filteredIds).toEqual([customerId]);
    expect(response.data).toHaveLength(1);
    expect(response.data[0]).toMatchObject({
      alojamientoId: rows[0].alojamiento_id,
      alojamiento: { nombre: 'Suite Quito', ciudad: 'Quito' },
      clienteNombre: 'María Pérez',
    });
  });

  it('cancels a future reservation owned by the customer and records a simulated refund', async () => {
    const customerId = '50000000-0000-4000-8000-000000000001';
    const reservationId = '40000000-0000-4000-8000-000000000001';
    const updateValues: unknown[] = [];
    const eventInserts: unknown[] = [];
    let reservationQueryCount = 0;
    const updatedReservation = {
      id: reservationId,
      alojamiento_id: '10000000-0000-4000-8000-000000000001',
      cliente_nombre: 'María Pérez',
      cliente_email: 'maria@example.com',
      cliente_telefono: '+593991234567',
      fecha_checkin: '2099-11-10',
      fecha_checkout: '2099-11-13',
      num_huespedes: 2,
      precio_total: 255,
      moneda: 'USD',
      metodo_pago_simulado: 'tarjeta',
      pago_estado: 'exitoso',
      pago_referencia: '30000000-0000-4000-8000-000000000001',
      estado: 'cancelada',
      created_at: '2026-10-07T00:00:00.000Z',
    };
    const supabaseStub = {
      from: (table: string) => {
        if (table === 'reservas') {
          reservationQueryCount += 1;
          if (reservationQueryCount === 1) {
            return new QueryMock(
              {
                data: {
                  id: reservationId,
                  estado: 'confirmada',
                  fecha_checkin: '2099-11-10',
                },
                error: null,
              },
              () => ({ data: null, error: null }),
            );
          }
          return new QueryMock(
            { data: updatedReservation, error: null },
            (value) => {
              updateValues.push(value);
              return { data: updatedReservation, error: null };
            },
          );
        }
        if (table === 'eventos_log') {
          return {
            insert: (value: unknown) => {
              eventInserts.push(value);
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        throw new Error(`Unexpected Supabase table: ${table}`);
      },
    } as unknown as SupabaseClient;
    const service = new ReservationsService(supabaseStub);

    const response = await service.cancel(
      reservationId,
      { confirmacionPagoSimulado: true },
      {
        id: customerId,
        email: 'maria@example.com',
        role: 'cliente',
      },
    );

    expect(updateValues).toEqual([{ estado: 'cancelada' }]);
    expect(eventInserts[0]).toMatchObject({
      tipo_evento: 'ReservaCanceladaEvent',
      payload: {
        eventType: 'ReservaCanceladaEvent',
        data: {
          reservaId: reservationId,
          clienteId: customerId,
          pagoCancelacion: { estado: 'simulado' },
        },
      },
    });
    expect(JSON.stringify(eventInserts)).not.toMatch(/cardNumber|cvc|4242/);
    expect(response).toMatchObject({
      data: { id: reservationId, estado: 'cancelada' },
      pagoCancelacion: { estado: 'simulado', simulado: true },
    });
  });

  it('does not reveal or cancel a reservation that does not belong to the customer', async () => {
    const supabaseStub = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const service = new ReservationsService(supabaseStub);

    await expect(
      service.cancel(
        '40000000-0000-4000-8000-000000000001',
        { confirmacionPagoSimulado: true },
        {
          id: '50000000-0000-4000-8000-000000000001',
          email: 'maria@example.com',
          role: 'cliente',
        },
      ),
    ).rejects.toThrow(/no se encontró una reserva cancelable/i);
  });
});
