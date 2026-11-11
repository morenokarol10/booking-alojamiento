import { IntegrationOrderController } from './integration-order.controller';
import { IntegrationOrderService } from './integration-order.service';

describe('IntegrationOrderController', () => {
  it('accepts a BKG reservation code when cancelling an order', async () => {
    const integrationOrderService = {
      cancel: jest.fn().mockResolvedValue({
        body: { orderId: '4cc82cb3-4f3a-474c-b04b-bff402b52d57' },
        replayed: false,
      }),
    };
    const controller = new IntegrationOrderController(
      integrationOrderService as unknown as IntegrationOrderService,
    );
    const response = { setHeader: jest.fn() };

    await controller.cancel(
      'BKG-763424',
      undefined,
      '9b0f4e62-a7d1-4c65-9898-efde6f22a223',
      undefined,
      response as never,
    );

    expect(integrationOrderService.cancel).toHaveBeenCalledWith(
      'BKG-763424',
      expect.any(Object),
      '9b0f4e62-a7d1-4c65-9898-efde6f22a223',
      expect.any(String),
    );
  });

  it('accepts a BKG reference for the contracted checkout route', async () => {
    const integrationOrderService = {
      checkOut: jest.fn().mockResolvedValue({
        orderId: '4cc82cb3-4f3a-474c-b04b-bff402b52d57',
        estado: 'CHECKED_OUT',
      }),
    };
    const controller = new IntegrationOrderController(
      integrationOrderService as unknown as IntegrationOrderService,
    );
    const response = { setHeader: jest.fn() };

    await controller.checkOut(
      'BKG-763424',
      undefined,
      undefined,
      response as never,
    );

    expect(integrationOrderService.checkOut).toHaveBeenCalledWith(
      'BKG-763424',
      expect.any(Object),
      expect.any(String),
    );
  });
});
