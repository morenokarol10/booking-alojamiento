import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AccommodationsService,
  peakRoomsReserved,
  roomTypeCode,
} from './accommodations.service';

describe('Accommodation room types', () => {
  it('builds stable codes from room names', () => {
    expect(roomTypeCode('Habitación doble')).toBe('HABITACION_DOBLE');
    expect(roomTypeCode('  Suite  Presidencial! ')).toBe('SUITE_PRESIDENCIAL');
    expect(roomTypeCode('ñ')).toBe('HABITACION');
  });

  it('computes the busiest future night', () => {
    const reservations = [
      {
        fecha_checkin: '2026-12-01',
        fecha_checkout: '2026-12-04',
        cantidad_habitaciones: 1,
      },
      {
        fecha_checkin: '2026-12-02',
        fecha_checkout: '2026-12-03',
        cantidad_habitaciones: 2,
      },
      {
        fecha_checkin: '2026-12-10',
        fecha_checkout: '2026-12-11',
        cantidad_habitaciones: 1,
      },
    ];
    expect(peakRoomsReserved(reservations, '2026-11-20')).toBe(3);
  });

  const supabaseWith = (reserved: Array<Record<string, unknown>>) => {
    const writes: Array<{ table: string; op: string; value: unknown }> = [];
    const chain = (result: unknown) => {
      const query: Record<string, jest.Mock> = {};
      for (const method of ['select', 'eq', 'in', 'not', 'gt']) {
        query[method] = jest.fn(() => query);
      }
      // Imita el query builder de Supabase, que se resuelve con await.
      // oxlint-disable-next-line unicorn/no-thenable
      (query as unknown as { then: unknown }).then = (
        resolve: (value: unknown) => unknown,
      ) => resolve(result);
      return query;
    };
    const from = jest.fn((table: string) => {
      if (table === 'tipos_habitacion') {
        const query = chain({
          data: [
            {
              id: 'std',
              codigo: 'HABITACION_ESTANDAR',
              nombre: 'Habitación estándar',
              activo: true,
            },
          ],
          error: null,
        });
        query.upsert = jest.fn((value: unknown) => {
          writes.push({ table, op: 'upsert', value });
          return Promise.resolve({ error: null });
        });
        query.update = jest.fn((value: unknown) => {
          writes.push({ table, op: 'update', value });
          return query;
        });
        return query;
      }
      if (table === 'reservas') {
        return chain({ data: reserved, error: null });
      }
      const query = chain({ data: null, error: null });
      query.update = jest.fn((value: unknown) => {
        writes.push({ table, op: 'update', value });
        return query;
      });
      return query;
    });
    return { client: { from } as unknown as SupabaseClient, writes };
  };

  const rooms = [
    {
      nombre: 'Habitación simple',
      cantidad: 1,
      camas: 1,
      capacidadAdultos: 1,
      precioNoche: 40,
    },
    {
      nombre: 'Habitación doble',
      cantidad: 2,
      camas: 2,
      capacidadAdultos: 2,
      precioNoche: 60,
    },
    {
      nombre: 'Habitación familiar',
      cantidad: 3,
      camas: 2,
      descripcionCamas: '1 cama matrimonial y 1 cama individual',
      capacidadAdultos: 4,
      precioNoche: 90,
    },
  ];

  it('saves each room type and recalculates the accommodation totals', async () => {
    const { client, writes } = supabaseWith([]);
    const service = new AccommodationsService(client);
    const sync = (
      service as unknown as {
        syncRoomTypes: (id: string, value: unknown) => Promise<void>;
      }
    ).syncRoomTypes.bind(service);

    await sync('aloj-1', rooms);

    const upsert = writes.find((write) => write.op === 'upsert');
    expect(upsert?.value).toEqual([
      expect.objectContaining({
        codigo: 'HABITACION_SIMPLE',
        habitaciones_totales: 1,
        numero_camas: 1,
        camas: '1 cama',
      }),
      expect.objectContaining({
        codigo: 'HABITACION_DOBLE',
        habitaciones_totales: 2,
        numero_camas: 2,
      }),
      expect.objectContaining({
        codigo: 'HABITACION_FAMILIAR',
        habitaciones_totales: 3,
        camas: '1 cama matrimonial y 1 cama individual',
      }),
    ]);
    expect(writes).toContainEqual({
      table: 'tipos_habitacion',
      op: 'update',
      value: { activo: false },
    });
    expect(writes).toContainEqual({
      table: 'alojamientos',
      op: 'update',
      value: {
        habitaciones_disponibles: 6,
        capacidad_maxima: 4,
        precio_base_noche: 40,
      },
    });
  });

  it('refuses to remove a room type that still has upcoming reservations', async () => {
    const { client, writes } = supabaseWith([
      {
        tipo_habitacion_id: 'std',
        fecha_checkin: '2099-01-10',
        fecha_checkout: '2099-01-12',
        cantidad_habitaciones: 1,
      },
    ]);
    const service = new AccommodationsService(client);
    const sync = (
      service as unknown as {
        syncRoomTypes: (id: string, value: unknown) => Promise<void>;
      }
    ).syncRoomTypes.bind(service);

    await expect(sync('aloj-1', rooms)).rejects.toThrow(
      /No puedes quitar "Habitación estándar"/,
    );
    expect(writes).toEqual([]);
  });
});
