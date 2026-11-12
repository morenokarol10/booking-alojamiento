import type { SupabaseClient } from '@supabase/supabase-js';
import { ReservationsService } from './reservations.service';

describe('ReservationsService pending Booking check-in retry', () => {
  afterEach(() => jest.restoreAllMocks());

  const createSupabase = (confirmedOrders: string[]) => {
    const inserts: unknown[] = [];
    const eventQuery = (rows: unknown[]) => {
      const query = {
        select: jest.fn(),
        eq: jest.fn(),
        order: jest.fn(),
        limit: jest.fn().mockResolvedValue({ data: rows, error: null }),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.order.mockReturnValue(query);
      return query;
    };
    const pending = [
      {
        payload: {
          data: { external_order_id: 'ORD-HTL-AAA111', huespedes_reales: 2 },
        },
      },
      {
        payload: {
          data: { external_order_id: 'ORD-HTL-BBB222', huespedes_reales: 1 },
        },
      },
    ];
    const confirmed = confirmedOrders.map((orderId) => ({
      payload: { data: { external_order_id: orderId } },
    }));
    let eventReads = 0;
    const from = jest.fn((table: string) => {
      if (table === 'eventos_log') {
        eventReads += 1;
        if (eventReads === 1) return eventQuery(pending);
        if (eventReads === 2) return eventQuery(confirmed);
        return {
          insert: (value: unknown) => {
            inserts.push(value);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      const reservationQuery = {
        select: jest.fn(),
        eq: jest.fn(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: {
            id: 'reservation-uuid',
            estado_integracion: 'CHECKED_IN',
            huespedes_reales: 2,
          },
          error: null,
        }),
      };
      reservationQuery.select.mockReturnValue(reservationQuery);
      reservationQuery.eq.mockReturnValue(reservationQuery);
      return reservationQuery;
    });
    return { client: { from } as unknown as SupabaseClient, inserts };
  };

  it('confirms only the pending check-ins that Booking Core has not received', async () => {
    const { client, inserts } = createSupabase(['ORD-HTL-BBB222']);
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const service = new ReservationsService(client, {
      get: jest.fn((key: string) =>
        key === 'API_KEY' ? 'node-key' : undefined,
      ),
    } as never);

    await expect(service.retryPendingBookingCheckins()).resolves.toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0][0] as URL).href).toContain('ORD-HTL-AAA111');
    expect(inserts).toEqual([
      expect.objectContaining({ tipo_evento: 'CheckinBookingConfirmadoEvent' }),
    ]);
  });

  it('does nothing on a server without API key', async () => {
    const { client } = createSupabase([]);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const service = new ReservationsService(client, {
      get: jest.fn(),
    } as never);

    await expect(service.retryPendingBookingCheckins()).resolves.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
