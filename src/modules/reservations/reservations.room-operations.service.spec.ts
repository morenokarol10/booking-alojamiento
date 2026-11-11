import type { SupabaseClient } from '@supabase/supabase-js';
import { ReservationsService } from './reservations.service';

describe('ReservationsService room operations', () => {
  it('starts checkout and returns the persisted cleaning information', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        orderId: 'reservation-uuid',
        estado: 'CHECKED_OUT',
        limpiezaEstado: 'LIMPIEZA',
      },
      error: null,
    });
    const service = new ReservationsService(
      { rpc } as unknown as SupabaseClient,
      { get: jest.fn() } as never,
    );

    await expect(
      service.checkOut('reservation-uuid', {}),
    ).resolves.toMatchObject({
      data: {
        orderId: 'reservation-uuid',
        estado: 'CHECKED_OUT',
        limpiezaEstado: 'LIMPIEZA',
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      'checkout_alojamiento_order_v2',
      expect.objectContaining({
        p_order_ref: 'reservation-uuid',
        p_consumos: [],
        p_metodo_pago: null,
      }),
    );
  });

  it('manually completes cleaning through the transactional database operation', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        orderId: 'reservation-uuid',
        limpiezasCompletadas: 1,
        yaEstabaLimpia: false,
      },
      error: null,
    });
    const service = new ReservationsService(
      { rpc } as unknown as SupabaseClient,
      { get: jest.fn() } as never,
    );

    await expect(
      service.completeRoomCleaning('reservation-uuid'),
    ).resolves.toMatchObject({
      data: {
        limpiezasCompletadas: 1,
        yaEstabaLimpia: false,
      },
    });
    expect(rpc).toHaveBeenCalledWith('complete_alojamiento_room_cleaning', {
      p_reservation_id: 'reservation-uuid',
    });
  });
});
