import { toReservaEntity } from './reserva.mapper';

describe('reserva mapper', () => {
  it('returns camelCase fields from a persisted booking and joined accommodation', () => {
    const entity = toReservaEntity({
      id: '40000000-0000-4000-8000-000000000001',
      alojamiento_id: '10000000-0000-4000-8000-000000000001',
      cliente_nombre: 'María Pérez',
      cliente_email: 'maria@example.com',
      cliente_telefono: '+593991234567',
      fecha_checkin: '2026-11-10',
      fecha_checkout: '2026-11-13',
      num_huespedes: 2,
      cantidad_habitaciones: 2,
      tipo_habitacion_id: '20000000-0000-4000-8000-000000000001',
      precio_total: '255.00',
      moneda: 'USD',
      metodo_pago_simulado: 'tarjeta',
      pago_estado: 'exitoso',
      pago_referencia: '30000000-0000-4000-8000-000000000001',
      estado: 'confirmada',
      estado_integracion: 'CONFIRMED',
      cotizacion_id: '30000000-0000-4000-8000-000000000002',
      created_at: '2026-10-07T00:00:00.000Z',
      alojamientos: {
        id: '10000000-0000-4000-8000-000000000001',
        nombre: 'Suite Quito',
        ciudad: 'Quito',
      },
      tipos_habitacion: {
        codigo: 'SUITE_FAMILIAR',
        nombre: 'Suite familiar',
      },
      reservas_unidades_habitacion: [
        {
          unidades_habitacion: {
            id: '50000000-0000-4000-8000-000000000001',
            codigo: 'SUITE_FAMILIAR-001',
            estado: 'RESERVADA',
            limpieza_hasta: null,
          },
        },
      ],
    });

    expect(entity).toMatchObject({
      alojamientoId: '10000000-0000-4000-8000-000000000001',
      clienteNombre: 'María Pérez',
      fechaCheckin: '2026-11-10',
      fechaCheckout: '2026-11-13',
      cantidadHabitaciones: 2,
      tipoHabitacionCodigo: 'SUITE_FAMILIAR',
      tipoHabitacionNombre: 'Suite familiar',
      cotizacionId: '30000000-0000-4000-8000-000000000002',
      precioTotal: 255,
      pagoEstado: 'exitoso',
      estado: 'confirmada',
      habitacionesAsignadas: [
        {
          id: '50000000-0000-4000-8000-000000000001',
          codigo: 'SUITE_FAMILIAR-001',
          estado: 'RESERVADA',
          limpiezaHasta: null,
        },
      ],
      alojamiento: { nombre: 'Suite Quito', ciudad: 'Quito' },
    });
    expect(entity).not.toHaveProperty('cliente_nombre');
    expect(entity).not.toHaveProperty('precio_total');
  });
});
