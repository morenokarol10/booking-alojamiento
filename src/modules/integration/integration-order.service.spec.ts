import { IntegrationCatalogService } from './integration-catalog.service';
import {
  IntegrationCancelOrderDto,
  IntegrationOrderCreateDto,
} from './integration-order.dto';
import { IntegrationOrderService } from './integration-order.service';

describe('IntegrationOrderService', () => {
  const idempotencyKey = '9b0f4e62-a7d1-4c65-9898-efde6f22a223';

  const createRequest = (
    overrides: Partial<IntegrationOrderCreateDto> = {},
  ): IntegrationOrderCreateDto =>
    ({
      alojamientoId: 'HTL-QUITO-001',
      tipoHabitacionCodigo: 'SUITE_DELUXE',
      fechaInicio: '2027-01-20',
      fechaFin: '2027-01-22',
      cantidadHabitaciones: 1,
      ocupantes: { adultos: 2, ninos: 0 },
      totalPagar: '230.00',
      huespedTitular: {
        nombreCompleto: 'Joselyn Cadena',
        tipoDocumento: 'CEDULA',
        identificacion: '1712345675',
        email: 'joselyn@example.com',
        telefono: '+593991234567',
      },
      ...overrides,
    }) as IntegrationOrderCreateDto;

  const createService = (
    rpcResult = {
      data: { orderId: '4cc82cb3-4f3a-474c-b04b-bff402b52d57' },
      error: null,
    },
  ) => {
    const rpc = jest.fn().mockResolvedValue(rpcResult);
    const catalog = {
      pricingForOrder: jest.fn().mockResolvedValue({
        nights: 2,
        accommodation: {
          id: 'accommodation-db-id',
          nombre: 'Hotel Quito',
          politica_cancelacion: 'Cancelación gratuita hasta 48 horas antes.',
          permite_paquete: false,
          descuento_maximo: 0,
        },
        room: {
          id: 'room-db-id',
          codigo: 'SUITE_DELUXE',
          nombre: 'Suite Deluxe',
          capacidad_maxima: 2,
          regimen: 'DESAYUNO_INCLUIDO',
          plan_tarifa_codigo: 'FLEX_BB',
        },
        breakdown: {
          subtotal: '200.00',
          ivaPorcentaje: 15,
          ivaValor: '30.00',
          tasaMunicipal: '0.00',
          descuentoCombo: '0.00',
          totalPagar: '230.00',
        },
      }),
    };
    const service = new IntegrationOrderService(
      { rpc } as never,
      catalog as unknown as IntegrationCatalogService,
    );
    return { service, rpc, catalog };
  };

  it('creates an order using the frozen price and returns the idempotent response', async () => {
    const { service, rpc } = createService({
      data: {
        orderId: '4cc82cb3-4f3a-474c-b04b-bff402b52d57',
        estado: 'CONFIRMED',
        _idempotent_replayed: false,
      },
      error: null,
    });

    await expect(
      service.create(createRequest(), idempotencyKey, 'corr-1234'),
    ).resolves.toEqual({
      body: {
        orderId: '4cc82cb3-4f3a-474c-b04b-bff402b52d57',
        estado: 'CONFIRMED',
      },
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      'create_alojamiento_order_v2',
      expect.objectContaining({
        p_idempotency_key: idempotencyKey,
        p_correlation_id: 'corr-1234',
      }),
    );
  });

  it('requires an idempotency UUID v4 before making database calls', async () => {
    const { service, rpc } = createService();

    await expect(
      service.create(createRequest(), undefined, 'corr-1234'),
    ).rejects.toMatchObject({ status: 422 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a client total that differs from the computed price', async () => {
    const { service, rpc } = createService();

    await expect(
      service.create(
        createRequest({ totalPagar: '229.99' }),
        idempotencyKey,
        'corr-1234',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes cancellation through the idempotent database operation', async () => {
    const { service, rpc } = createService({
      data: {
        orderId: '4cc82cb3-4f3a-474c-b04b-bff402b52d57',
        estado: 'CANCELLED',
        yaCancelada: false,
        _idempotent_replayed: true,
      },
      error: null,
    });

    await expect(
      service.cancel(
        'ORD-HTL-AB12',
        { solicitadoPor: 'SAGA_ORCHESTRATOR' } as IntegrationCancelOrderDto,
        idempotencyKey,
        'corr-1234',
      ),
    ).resolves.toEqual({
      body: {
        orderId: '4cc82cb3-4f3a-474c-b04b-bff402b52d57',
        estado: 'CANCELLED',
        yaCancelada: false,
      },
      replayed: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      'cancel_alojamiento_order_v2',
      expect.objectContaining({
        p_order_ref: 'ORD-HTL-AB12',
        p_requested_by: 'SAGA_ORCHESTRATOR',
      }),
    );
  });
});
