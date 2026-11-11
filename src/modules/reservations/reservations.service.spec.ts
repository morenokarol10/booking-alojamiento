import type { SupabaseClient } from '@supabase/supabase-js';
import { ReservationsService } from './reservations.service';

const createService = (supabase: SupabaseClient) =>
  new ReservationsService(supabase, { get: jest.fn() } as never);

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
    const service = createService({} as SupabaseClient);

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
    [
      'book_accommodation_room_if_available',
      'PGRST202',
      '202612120001_unified_marketplace_inventory.sql',
    ],
    [
      'reservas_marketplace_idempotencia',
      'PGRST204',
      '202612120001_unified_marketplace_inventory.sql',
    ],
    ['tipo_habitacion_id', '42703', '202612120001_unified_marketplace_inventory.sql'],
  ])(
    'explains how to repair Supabase when %s is missing',
    async (column, code, migration) => {
      const missingColumnError = {
        code,
        message: `Could not find ${column} in the schema cache`,
      };
      const supabaseStub = {
        rpc: () => Promise.resolve({ data: null, error: missingColumnError }),
      } as unknown as SupabaseClient;
      const service = createService(supabaseStub);

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
            phone: '+593991234567',
          },
        ),
      ).rejects.toThrow(migration);
    },
  );

  it('rejects reservations when Supabase reports no rooms for the requested dates', async () => {
    const accommodation = {
      id: '10000000-0000-4000-8000-000000000001',
    };
    const supabaseStub = {
      rpc: jest.fn(
        (functionName: string, parameters: Record<string, unknown>) => {
          expect(functionName).toBe('book_accommodation_room_if_available');
          expect(parameters).toMatchObject({
            p_alojamiento_id: accommodation.id,
            p_fecha_checkin: '2026-11-10',
            p_fecha_checkout: '2026-11-13',
          });
          return Promise.resolve({
            data: null,
            error: { code: 'P0001', message: 'NO_ROOMS_AVAILABLE' },
          });
        },
      ),
    } as unknown as SupabaseClient;
    const service = createService(supabaseStub);

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
    ).rejects.toThrow(/no hay habitaciones disponibles/i);
  });

  it('creates room-specific reservations through shared inventory', async () => {
    const inserts: Record<string, unknown[]> = {
      eventos_log: [],
    };
    const idempotencyKey = '60000000-0000-4000-8000-000000000001';
    const accommodation = {
      id: '10000000-0000-4000-8000-000000000001',
    };
    const reservation = {
      id: '40000000-0000-4000-8000-000000000001',
      alojamiento_id: accommodation.id,
      cliente_nombre: 'María Pérez',
      cliente_email: 'maria@example.com',
      cliente_telefono: '+593991234567',
      fecha_checkin: '2026-11-10',
      fecha_checkout: '2026-11-13',
      num_huespedes: 2,
      cantidad_habitaciones: 2,
      precio_total: 255,
      moneda: 'USD',
      metodo_pago_simulado: 'tarjeta',
      pago_estado: 'exitoso',
      pago_referencia: '30000000-0000-4000-8000-000000000001',
      estado: 'confirmada',
      created_at: '2026-10-07T00:00:00.000Z',
    };
    let replayed = false;
    const supabaseStub = {
      from: (table: string) => {
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
      rpc: jest.fn((functionName: string, parameters: unknown) => {
        expect(functionName).toBe('book_accommodation_room_if_available');
        expect(parameters).toMatchObject({
          p_idempotency_key: idempotencyKey,
          p_alojamiento_id: accommodation.id,
          p_cliente_id: '50000000-0000-4000-8000-000000000001',
          p_tipo_habitacion_codigo: 'SUITE_FAMILIAR',
          p_cantidad_habitaciones: 2,
          p_cotizacion_id: '30000000-0000-4000-8000-000000000002',
          p_fecha_checkin: '2026-11-10',
          p_fecha_checkout: '2026-11-13',
        });
        return Promise.resolve({
          data: { reservation, replayed },
          error: null,
        });
      }),
    } as unknown as SupabaseClient;
    const service = createService(supabaseStub);

    const response = await service.create(
      {
        alojamientoId: accommodation.id,
        fechaCheckin: '2026-11-10',
        fechaCheckout: '2026-11-13',
        numHuespedes: 2,
        tipoHabitacionCodigo: 'SUITE_FAMILIAR',
        cantidadHabitaciones: 2,
        cotizacionId: '30000000-0000-4000-8000-000000000002',
        metodoPagoSimulado: 'tarjeta',
      },
      {
        id: '50000000-0000-4000-8000-000000000001',
        email: 'maria@example.com',
        role: 'cliente',
        fullName: 'María Pérez',
        phone: '+593991234567',
      },
      idempotencyKey,
    );

    expect(response.data.cantidadHabitaciones).toBe(2);
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
    replayed = true;
    const replayResponse = await service.create(
      {
        alojamientoId: accommodation.id,
        fechaCheckin: '2026-11-10',
        fechaCheckout: '2026-11-13',
        numHuespedes: 2,
        tipoHabitacionCodigo: 'SUITE_FAMILIAR',
        cantidadHabitaciones: 2,
        cotizacionId: '30000000-0000-4000-8000-000000000002',
        metodoPagoSimulado: 'tarjeta',
      },
      {
        id: '50000000-0000-4000-8000-000000000001',
        email: 'maria@example.com',
        role: 'cliente',
        fullName: 'María Pérez',
        phone: '+593991234567',
      },
      idempotencyKey,
    );
    expect(replayResponse.message).toMatch(/solicitud ya había sido procesada/i);
    expect(inserts.eventos_log).toHaveLength(1);
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
    const service = createService(supabaseStub);

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
    const service = createService(supabaseStub);

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
    const service = createService(supabaseStub);

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
