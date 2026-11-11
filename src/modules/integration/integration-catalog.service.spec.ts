import { IntegrationCatalogService } from './integration-catalog.service';

describe('IntegrationCatalogService property endpoints', () => {
  const accommodation = {
    id: 'accommodation-uuid',
    codigo_integracion: 'HTL-QUITO-C62FE3F1',
    nombre: 'Hotel Quito',
    descripcion: 'Hotel en el centro de Quito.',
    ciudad: 'Quito',
    estrellas: 4,
    precio_base_noche: '85.00',
    moneda: 'USD',
    capacidad_maxima: 4,
    urls_imagenes: ['https://example.com/hotel.jpg'],
    iva_porcentaje: 15,
    tasa_municipal_por_noche: '0.00',
  };
  const room = {
    id: 'room-uuid',
    codigo: 'HABITACION_ESTANDAR',
    nombre: 'Habitación estándar',
    capacidad_maxima: 4,
    habitaciones_totales: 3,
    precio_base_noche: '85.00',
    regimen: 'SOLO_HABITACION',
    activo: true,
  };
  const reservation = {
    tipo_habitacion_id: 'room-uuid',
    cantidad_habitaciones: 1,
    fecha_checkin: '2099-01-20',
    fecha_checkout: '2099-01-22',
  };

  const createService = () => {
    const makeQuery = (result: unknown, table: string) => {
      const builder: Record<string, jest.Mock> = {};
      for (const method of [
        'select',
        'eq',
        'in',
        'neq',
        'gte',
      ]) {
        builder[method] = jest.fn(() => builder);
      }
      builder.order = jest.fn().mockResolvedValue(result);
      builder.lt = jest.fn(() =>
        table === 'reservas' ? builder : Promise.resolve(result),
      );
      builder.gt = jest.fn().mockResolvedValue(result);
      builder.maybeSingle = jest.fn().mockResolvedValue({
        data: accommodation,
        error: null,
      });
      return builder;
    };
    const from = jest.fn((table: string) => {
      if (table === 'alojamientos') {
        return makeQuery({ data: [accommodation], error: null }, table);
      }
      if (table === 'tipos_habitacion') {
        return makeQuery({ data: [room], error: null }, table);
      }
      if (table === 'reservas') {
        return makeQuery({ data: [reservation], error: null }, table);
      }
      return makeQuery({ data: [], error: null }, table);
    });
    const rpc = jest.fn((name: string) =>
      Promise.resolve(
        name === 'alojamientos_v2_disponibilidad'
          ? {
              data: [
                { habitaciones_remanentes: 2, habitaciones_totales: 3 },
              ],
              error: null,
            }
          : { data: null, error: null },
      ),
    );
    return {
      service: new IntegrationCatalogService({ from, rpc } as never),
      from,
      rpc,
    };
  };

  it('resolves a catalog id by codigo_integracion for the property detail', async () => {
    const { service, from } = createService();

    await expect(service.detail('HTL-QUITO-C62FE3F1')).resolves.toEqual({
      id: 'HTL-QUITO-C62FE3F1',
      nombre: 'Hotel Quito',
      descripcion: 'Hotel en el centro de Quito.',
      destino: 'Quito',
      estrellas: 4,
      precioPorNoche: '85.00',
      moneda: 'USD',
      capacidadAdultos: 4,
      fotos: ['https://example.com/hotel.jpg'],
    });
    expect(from).toHaveBeenCalledWith('alojamientos');
  });

  it('returns room types with the booking integration fields', async () => {
    const { service } = createService();

    await expect(
      service.rooms('HTL-QUITO-C62FE3F1'),
    ).resolves.toEqual([
      {
        codigo: 'HABITACION_ESTANDAR',
        nombre: 'Habitación estándar',
        cantidad: 3,
        capacidad_adultos: 4,
        capacidad_ninos: 0,
        precio_noche: '85.00',
        regimen: 'SOLO_HABITACION',
        cancelacion_gratuita_horas: 48,
      },
    ]);
  });

  it('returns available room types using the catalog id and requested dates', async () => {
    const { service, rpc } = createService();

    await expect(
      service.propertyAvailability('HTL-QUITO-C62FE3F1', {
        checkin: '2099-01-20',
        checkout: '2099-01-22',
        habitaciones: 1,
        adultos: 2,
      }),
    ).resolves.toEqual({
      alojamientoId: 'HTL-QUITO-C62FE3F1',
      checkin: '2099-01-20',
      checkout: '2099-01-22',
      total_rooms: 3,
      reserved_rooms: 1,
      available_rooms: 2,
      price_per_night: '85.00',
      tipos: [
        {
          id: 'room-uuid',
          codigo: 'HABITACION_ESTANDAR',
          nombre: 'Habitación estándar',
          precio_noche: '85.00',
          total_rooms: 3,
          available_rooms: 2,
        },
      ],
      noches: 2,
    });
    expect(rpc).toHaveBeenCalledWith(
      'alojamientos_v2_disponibilidad',
      expect.objectContaining({
        p_tipo_habitacion_id: 'room-uuid',
        p_fecha_inicio: '2099-01-20',
        p_fecha_fin: '2099-01-22',
      }),
    );
  });
});
