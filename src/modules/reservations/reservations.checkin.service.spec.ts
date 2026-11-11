import type { SupabaseClient } from '@supabase/supabase-js';
import { ReservationsService } from './reservations.service';

function createSupabase(reservation: Record<string, unknown>) {
  const lookupQuery = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data: reservation, error: null }),
  };
  lookupQuery.select.mockReturnValue(lookupQuery);
  lookupQuery.eq.mockReturnValue(lookupQuery);

  const updateQuery = {
    update: jest.fn(),
    eq: jest.fn(),
    select: jest.fn(),
    maybeSingle: jest
      .fn()
      .mockResolvedValue({ data: { id: reservation.id }, error: null }),
  };
  updateQuery.update.mockReturnValue(updateQuery);
  updateQuery.eq.mockReturnValue(updateQuery);
  updateQuery.select.mockReturnValue(updateQuery);

  const from = jest
    .fn()
    .mockReturnValueOnce(lookupQuery)
    .mockReturnValueOnce(updateQuery);
  return { client: { from } as unknown as SupabaseClient, from, updateQuery };
}

describe('ReservationsService in-person check-in', () => {
  const externalOrderId = 'ORD-HTL-AB12';

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('sends the exact Booking Core check-in payload and persists the confirmed state', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-20T19:00:00.000Z'));
    const { client, updateQuery } = createSupabase({
      id: 'reservation-uuid',
      external_order_id: externalOrderId,
      estado_integracion: 'CONFIRMED',
      huespedes_reales: null,
      fecha_checkin: '2027-01-20',
      fecha_checkout: '2027-01-22',
    });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const service = new ReservationsService(
      client,
      {
        get: jest.fn((key: string) =>
          key === 'API_KEY' ? 'server-secret' : undefined,
        ),
      } as never,
    );

    await expect(
      service.checkIn(externalOrderId, { huespedesReales: 2 }),
    ).resolves.toMatchObject({
      data: {
        external_order_id: externalOrderId,
        estado: 'CONFIRMADO_ASISTIDO',
        huespedes_reales: 2,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        `https://booking-core-api.azurewebsites.net/api/v1/reservas/${externalOrderId}/checkin`,
      ),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'server-secret',
        },
        body: JSON.stringify({
          external_order_id: externalOrderId,
          estado: 'CONFIRMADO_ASISTIDO',
          huespedes_reales: 2,
        }),
      }),
    );
    expect(updateQuery.update).toHaveBeenCalledWith({
      estado_integracion: 'CHECKED_IN',
      huespedes_reales: 2,
    });
  });

  it('does not call Booking Core again when the same check-in is retried', async () => {
    const { client, from } = createSupabase({
      id: 'reservation-uuid',
      external_order_id: externalOrderId,
      estado_integracion: 'CHECKED_IN',
      huespedes_reales: 2,
    });
    const fetch = jest.spyOn(globalThis, 'fetch');
    const service = new ReservationsService(
      client,
      { get: jest.fn() } as never,
    );

    await expect(
      service.checkIn(externalOrderId, { huespedesReales: 2 }),
    ).resolves.toMatchObject({
      data: { estado: 'CONFIRMADO_ASISTIDO', huespedes_reales: 2 },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('reports an upstream rejection without marking the reservation checked in', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-20T19:00:00.000Z'));
    const { client, from } = createSupabase({
      id: 'reservation-uuid',
      external_order_id: externalOrderId,
      estado_integracion: 'CONFIRMED',
      huespedes_reales: null,
      fecha_checkin: '2027-01-20',
      fecha_checkout: '2027-01-22',
    });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 401 } as Response);
    const service = new ReservationsService(
      client,
      {
        get: jest.fn((key: string) =>
          key === 'API_KEY' ? 'server-secret' : undefined,
        ),
      } as never,
    );

    await expect(
      service.checkIn(externalOrderId, { huespedesReales: 2 }),
    ).rejects.toMatchObject({ status: 502 });
    expect(from).toHaveBeenCalledTimes(1);
  });
});
