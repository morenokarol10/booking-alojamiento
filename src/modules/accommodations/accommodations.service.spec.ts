import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccommodationsService } from './accommodations.service';
import type { CreateAlojamientoDto } from './dto/create-alojamiento.dto';

describe('AccommodationsService.create', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs Supabase errors and returns a clear HTTP error', async () => {
    const databaseError = {
      code: '23514',
      message: 'new row violates check constraint',
    };
    const logError = jest.spyOn(console, 'error').mockImplementation();
    const supabase = {
      from: jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: databaseError,
            }),
          })),
        })),
      })),
    } as unknown as SupabaseClient;
    const service = new AccommodationsService(supabase);

    await expect(service.create({} as CreateAlojamientoDto)).rejects.toThrow(
      new BadRequestException(
        'No se pudo crear el alojamiento: new row violates check constraint',
      ),
    );
    expect(logError).toHaveBeenCalledWith(
      'Supabase create alojamiento error:',
      databaseError,
    );
  });

  it('inserts only database columns and flattens coordinates', async () => {
    let inserted: Record<string, unknown> | undefined;
    const row = {
      id: '10000000-0000-4000-8000-000000000001',
      proveedor_id: '20000000-0000-4000-8000-000000000001',
      nombre: 'Suite Quito',
      descripcion: 'Suite cerca del centro.',
      tipo: 'hotel',
      ciudad: 'Quito',
      direccion: 'Centro Histórico',
      latitud: -0.22,
      longitud: -78.51,
      precio_base_noche: 85.5,
      moneda: 'USD',
      capacidad_maxima: 4,
      habitaciones_disponibles: 2,
      servicios: ['WiFi'],
      politica_cancelacion: 'Flexible',
      urls_imagenes: ['https://example.com/suite.jpg'],
      created_at: '2026-10-07T00:00:00.000Z',
    };
    const supabase = {
      from: jest.fn(() => ({
        insert: jest.fn((payload: Record<string, unknown>) => {
          inserted = payload;
          return {
            select: jest.fn(() => ({
              single: jest.fn().mockResolvedValue({ data: row, error: null }),
            })),
          };
        }),
      })),
    } as unknown as SupabaseClient;
    const service = new AccommodationsService(supabase);

    await service.create({
      proveedorId: row.proveedor_id,
      nombre: row.nombre,
      descripcion: row.descripcion,
      tipo: 'hotel',
      ciudad: row.ciudad,
      direccion: row.direccion,
      coordenadas: { latitud: -0.22, longitud: -78.51 },
      precioBaseNoche: 85.5,
      moneda: 'USD',
      capacidadMaxima: 4,
      habitacionesDisponibles: 2,
      servicios: ['WiFi'],
      politicaCancelacion: 'Flexible',
      imagenes: ['https://example.com/suite.jpg'],
    });

    expect(inserted).toEqual({
      proveedor_id: row.proveedor_id,
      nombre: row.nombre,
      descripcion: row.descripcion,
      tipo: row.tipo,
      ciudad: row.ciudad,
      direccion: row.direccion,
      latitud: -0.22,
      longitud: -78.51,
      precio_base_noche: 85.5,
      moneda: 'USD',
      capacidad_maxima: 4,
      habitaciones_disponibles: 2,
      servicios: ['WiFi'],
      politica_cancelacion: 'Flexible',
      urls_imagenes: ['https://example.com/suite.jpg'],
    });
    expect(inserted).not.toHaveProperty('coordenadas');
    expect(Object.keys(inserted ?? {})).toHaveLength(15);
  });
});
