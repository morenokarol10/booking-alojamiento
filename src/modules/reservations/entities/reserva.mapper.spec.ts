import { toReservaDatabase, toReservaEntity } from './reserva.mapper';
import { CreateReservaDto } from '../dto/create-reserva.dto';

describe('reserva mapper', () => {
  const dto = {
    alojamientoId: '10000000-0000-4000-8000-000000000001',
    clienteNombre: 'María Pérez',
    clienteEmail: 'maria@example.com',
    clienteTelefono: '+593991234567',
    fechaCheckin: '2026-11-10',
    fechaCheckout: '2026-11-13',
    numHuespedes: 2,
    metodoPagoSimulado: 'tarjeta',
  } satisfies CreateReservaDto;

  it('maps booking request and simulated successful payment to database columns', () => {
    expect(
      toReservaDatabase(dto, {
        precioTotal: 255,
        moneda: 'USD',
        pagoReferencia: '30000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      alojamiento_id: dto.alojamientoId,
      cliente_nombre: dto.clienteNombre,
      cliente_email: dto.clienteEmail,
      cliente_telefono: dto.clienteTelefono,
      fecha_checkin: dto.fechaCheckin,
      fecha_checkout: dto.fechaCheckout,
      num_huespedes: 2,
      precio_total: 255,
      moneda: 'USD',
      metodo_pago_simulado: 'tarjeta',
      pago_estado: 'exitoso',
      pago_referencia: '30000000-0000-4000-8000-000000000001',
      estado: 'confirmada',
    });
  });

  it('returns camelCase fields from a persisted booking and joined accommodation', () => {
    const entity = toReservaEntity({
      id: '40000000-0000-4000-8000-000000000001',
      alojamiento_id: dto.alojamientoId,
      cliente_nombre: dto.clienteNombre,
      cliente_email: dto.clienteEmail,
      cliente_telefono: dto.clienteTelefono,
      fecha_checkin: dto.fechaCheckin,
      fecha_checkout: dto.fechaCheckout,
      num_huespedes: 2,
      precio_total: '255.00',
      moneda: 'USD',
      metodo_pago_simulado: 'tarjeta',
      pago_estado: 'exitoso',
      pago_referencia: '30000000-0000-4000-8000-000000000001',
      estado: 'confirmada',
      created_at: '2026-10-07T00:00:00.000Z',
      alojamientos: {
        id: dto.alojamientoId,
        nombre: 'Suite Quito',
        ciudad: 'Quito',
      },
    });

    expect(entity).toMatchObject({
      alojamientoId: dto.alojamientoId,
      clienteNombre: dto.clienteNombre,
      fechaCheckin: dto.fechaCheckin,
      precioTotal: 255,
      pagoEstado: 'exitoso',
      estado: 'confirmada',
      alojamiento: { nombre: 'Suite Quito', ciudad: 'Quito' },
    });
    expect(entity).not.toHaveProperty('cliente_nombre');
    expect(entity).not.toHaveProperty('precio_total');
  });
});
