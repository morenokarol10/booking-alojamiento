import type { SupabaseClient } from '@supabase/supabase-js';
import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
  const userId = '50000000-0000-4000-8000-000000000001';
  const accommodationId = '10000000-0000-4000-8000-000000000001';

  it('lists favorites filtered by the authenticated user ID', async () => {
    const order = jest.fn().mockResolvedValue({
      data: [{ alojamiento_id: accommodationId }],
      error: null,
    });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    const service = new FavoritesService({
      from: jest.fn().mockReturnValue({ select }),
    } as unknown as SupabaseClient);

    await expect(service.findMine(userId)).resolves.toMatchObject({
      data: [accommodationId],
    });
    expect(eq).toHaveBeenCalledWith('cliente_id', userId);
  });

  it('stores a favorite with server-derived user ID and is idempotent', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: accommodationId },
      error: null,
    });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const service = new FavoritesService({
      from: jest
        .fn()
        .mockReturnValueOnce({ select })
        .mockReturnValueOnce({ upsert }),
    } as unknown as SupabaseClient);

    await service.add(userId, accommodationId);

    expect(upsert).toHaveBeenCalledWith(
      { cliente_id: userId, alojamiento_id: accommodationId },
      {
        onConflict: 'cliente_id,alojamiento_id',
        ignoreDuplicates: true,
      },
    );
  });

  it('removes favorites only for the authenticated user', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { alojamiento_id: accommodationId },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const secondEq = jest.fn().mockReturnValue({ select });
    const firstEq = jest.fn().mockReturnValue({ eq: secondEq });
    const service = new FavoritesService({
      from: jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnValue({ eq: firstEq }),
      }),
    } as unknown as SupabaseClient);

    await service.remove(userId, accommodationId);

    expect(firstEq).toHaveBeenCalledWith('cliente_id', userId);
    expect(secondEq).toHaveBeenCalledWith('alojamiento_id', accommodationId);
  });
});
