import {
  toAlojamientoDatabase,
  toAlojamientoEntity,
} from './alojamiento.mapper';
import { CreateAlojamientoDto } from '../dto/create-alojamiento.dto';

describe('alojamiento mapper', () => {
  it('maps request camelCase fields to Supabase snake_case columns', () => {
    const dto = {
      proveedorId: '20000000-0000-4000-8000-000000000001',
      nombre: 'Suite Quito',
      tipo: 'hotel' as const,
      ciudad: 'Quito',
      direccion: 'Centro Histórico',
      coordenadas: { latitud: -0.22, longitud: -78.51 },
      precioBaseNoche: 85,
      moneda: 'USD',
      capacidadMaxima: 4,
      habitacionesDisponibles: 2,
      servicios: ['wifi'],
      politicaCancelacion: 'Flexible',
      imagenes: ['https://example.com/room.jpg'],
    } satisfies CreateAlojamientoDto;

    expect(toAlojamientoDatabase(dto)).toEqual({
      proveedor_id: dto.proveedorId,
      nombre: dto.nombre,
      tipo: dto.tipo,
      ciudad: dto.ciudad,
      direccion: dto.direccion,
      coordenadas: dto.coordenadas,
      precio_base_noche: dto.precioBaseNoche,
      moneda: dto.moneda,
      capacidad_maxima: dto.capacidadMaxima,
      habitaciones_disponibles: dto.habitacionesDisponibles,
      servicios: dto.servicios,
      politica_cancelacion: dto.politicaCancelacion,
      imagenes: dto.imagenes,
    });
  });

  it('maps persisted fields back to the camelCase API entity', () => {
    const entity = toAlojamientoEntity({
      id: '10000000-0000-4000-8000-000000000001',
      proveedor_id: '20000000-0000-4000-8000-000000000001',
      nombre: 'Suite Quito',
      descripcion: null,
      tipo: 'hotel',
      ciudad: 'Quito',
      direccion: 'Centro Histórico',
      coordenadas: { latitud: -0.22, longitud: -78.51 },
      precio_base_noche: '85.00',
      moneda: 'USD',
      capacidad_maxima: 4,
      habitaciones_disponibles: 2,
      servicios: ['wifi'],
      politica_cancelacion: null,
      imagenes: ['https://example.com/room.jpg'],
      created_at: '2026-10-07T00:00:00.000Z',
    });

    expect(entity).toMatchObject({
      proveedorId: '20000000-0000-4000-8000-000000000001',
      nombre: 'Suite Quito',
      precioBaseNoche: 85,
      capacidadMaxima: 4,
      habitacionesDisponibles: 2,
      createdAt: '2026-10-07T00:00:00.000Z',
    });
    expect(entity).not.toHaveProperty('proveedor_id');
    expect(entity).not.toHaveProperty('precio_base_noche');
  });

  it.each([
    ['native text array', ['WiFi', 'Desayuno incluido']],
    ['JSON-encoded text array', '["WiFi","Desayuno incluido"]'],
  ])('normalizes services from a %s', (_description, servicios) => {
    const entity = toAlojamientoEntity({
      id: '10000000-0000-4000-8000-000000000001',
      proveedor_id: '20000000-0000-4000-8000-000000000001',
      nombre: 'Suite Quito',
      descripcion: null,
      tipo: 'hotel',
      ciudad: 'Quito',
      direccion: 'Centro Histórico',
      coordenadas: { latitud: -0.22, longitud: -78.51 },
      precio_base_noche: '85.00',
      moneda: 'USD',
      capacidad_maxima: 4,
      habitaciones_disponibles: 2,
      servicios,
      politica_cancelacion: null,
      imagenes: '["https://example.com/room.jpg"]',
      created_at: '2026-10-07T00:00:00.000Z',
    });

    expect(entity.servicios).toEqual(['WiFi', 'Desayuno incluido']);
    expect(entity.imagenes).toEqual(['https://example.com/room.jpg']);
  });

  it.each(['not json', '{"servicio":"WiFi"}', '[1,2]'])(
    'rejects malformed JSON array values for services: %s',
    (servicios) => {
      expect(() =>
        toAlojamientoEntity({
          id: '10000000-0000-4000-8000-000000000001',
          proveedor_id: '20000000-0000-4000-8000-000000000001',
          nombre: 'Suite Quito',
          descripcion: null,
          tipo: 'hotel',
          ciudad: 'Quito',
          direccion: 'Centro Histórico',
          coordenadas: { latitud: -0.22, longitud: -78.51 },
          precio_base_noche: '85.00',
          moneda: 'USD',
          capacidad_maxima: 4,
          habitaciones_disponibles: 2,
          servicios,
          politica_cancelacion: null,
          imagenes: [],
          created_at: '2026-10-07T00:00:00.000Z',
        }),
      ).toThrow('Supabase devolvió una lista no válida para servicios.');
    },
  );

  it.each([
    ['null coordinates', null],
    ['a non-object JSON value', 'not coordinates'],
    [
      'coordinates with an invalid latitude',
      { latitud: 'invalid', longitud: -78.51 },
    ],
    ['coordinates missing a longitude', { latitud: -0.22 }],
  ])(
    'uses Quito coordinates when Supabase returns %s',
    (_description, value) => {
      const entity = toAlojamientoEntity({
        id: '10000000-0000-4000-8000-000000000001',
        proveedor_id: '20000000-0000-4000-8000-000000000001',
        nombre: 'Suite Quito',
        descripcion: null,
        tipo: 'hotel',
        ciudad: 'Quito',
        direccion: 'Centro Histórico',
        coordenadas: value,
        precio_base_noche: '85.00',
        moneda: 'USD',
        capacidad_maxima: 4,
        habitaciones_disponibles: 2,
        servicios: ['wifi'],
        politica_cancelacion: null,
        imagenes: ['https://example.com/room.jpg'],
        created_at: '2026-10-07T00:00:00.000Z',
      });

      expect(entity.coordenadas).toEqual({
        latitud: -0.1807,
        longitud: -78.4678,
      });
    },
  );
});
