import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel } from 'amqplib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IntegrationStockSyncService } from './integration-stock-sync.service';

describe('IntegrationStockSyncService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(overrides: Record<string, string> = {}) {
    const values: Record<string, string> = {
      INVENTORY_SERVICE_ID: 'NODE_ALO_TEST',
      RABBITMQ_EXCHANGE: 'booking.events',
      RABBITMQ_ROUTING_KEY: 'stock.updated',
      EVENT_BUS_MODE: 'rabbitmq',
      ...overrides,
    };
    const config = {
      get: (name: string) => values[name],
    };
    return new IntegrationStockSyncService(
      {} as SupabaseClient,
      config as ConfigService,
    );
  }

  it('publishes the agreed stock event with persistent delivery and confirm', async () => {
    const service = createService();
    const channel = {
      publish: jest.fn(
        (
          _exchange: string,
          _routingKey: string,
          _content: Buffer,
          _options: Record<string, unknown>,
          callback: (error: Error | null) => void,
        ) => {
          callback(null);
          return true;
        },
      ),
    } as unknown as ConfirmChannel;

    await service['publish'](channel, {
      id: 'outbox-event-1',
      data: {
        alojamientoId: 'HTL-QUITO-001',
        tipoHabitacionCodigo: 'SUITE_DELUXE',
        fecha: '2026-11-09',
        unidadesDisponibles: 3,
        reason: 'ORDER_CREATED',
      },
    });

    const [exchange, routingKey, content, options] =
      channel.publish.mock.calls[0];
    expect(exchange).toBe('booking.events');
    expect(routingKey).toBe('stock.updated');
    expect(JSON.parse(content.toString())).toEqual({
      service_id: 'NODE_ALO_TEST',
      item_id: 'HTL-QUITO-001:SUITE_DELUXE',
      available_units: 3,
      date: '2026-11-09',
      reason: 'ORDER_CREATED',
    });
    expect(options).toMatchObject({
      contentType: 'application/json',
      deliveryMode: 2,
      mandatory: true,
      messageId: 'outbox-event-1',
    });
  });

  it('keeps an event unconfirmed when RabbitMQ returns it as unroutable', async () => {
    const service = createService();
    service['returnedMessages'].add('outbox-event-2');
    const channel = {
      publish: jest.fn(
        (
          _exchange: string,
          _routingKey: string,
          _content: Buffer,
          _options: Record<string, unknown>,
          callback: (error: Error | null) => void,
        ) => {
          callback(null);
          return true;
        },
      ),
    } as unknown as ConfirmChannel;

    await expect(
      service['publish'](channel, {
        id: 'outbox-event-2',
        data: {
          alojamientoId: 'HTL-QUITO-001',
          tipoHabitacionCodigo: 'SUITE_DELUXE',
          fecha: '2026-11-09',
          unidadesDisponibles: 3,
          reason: 'ORDER_CREATED',
        },
      }),
    ).rejects.toThrow('has no queue bound to "stock.updated"');
  });

  it('posts the documented stock snapshot to Booking REST with the API key', async () => {
    const service = createService({
      STOCK_SYNC_MODE: 'rest',
      BOOKING_REST_STOCK_URL:
        'https://booking-core-api.azurewebsites.net/api/v3/inventory/stock',
      API_KEY: 'integration-secret',
    });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    await service['publishRest']({
      id: 'outbox-event-1',
      data: {
        alojamientoId: 'HTL-QUITO-001',
        tipoHabitacionCodigo: 'SUITE_DELUXE',
        fecha: '2026-11-09',
        unidadesDisponibles: 3,
        reason: 'ORDER_CREATED',
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      new URL(
        'https://booking-core-api.azurewebsites.net/api/v3/inventory/stock',
      ),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'integration-secret',
        },
        body: JSON.stringify({
          item_id: 'HTL-QUITO-001:SUITE_DELUXE',
          available_units: 3,
          date: '2026-11-09',
          reason: 'ORDER_CREATED',
        }),
      }),
    );
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps a REST stock event unconfirmed when Booking rejects it', async () => {
    const service = createService({
      STOCK_SYNC_MODE: 'rest',
      API_KEY: 'integration-secret',
    });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(
      service['publishRest']({
        id: 'outbox-event-2',
        data: {
          alojamientoId: 'HTL-QUITO-001',
          tipoHabitacionCodigo: 'SUITE_DELUXE',
          fecha: '2026-11-09',
          unidadesDisponibles: 3,
          reason: 'ORDER_CREATED',
        },
      }),
    ).rejects.toThrow('Booking stock endpoint returned HTTP 401.');
  });

  it('requires an API key and HTTPS stock endpoint for REST mode', () => {
    expect(
      () => createService({ STOCK_SYNC_MODE: 'rest' }),
    ).toThrow('API_KEY is required when STOCK_SYNC_MODE is "rest".');
    expect(
      () =>
        createService({
          STOCK_SYNC_MODE: 'rest',
          API_KEY: 'integration-secret',
          BOOKING_REST_STOCK_URL:
            'http://booking-core-api.azurewebsites.net/api/v3/inventory/stock',
        }),
    ).toThrow('must use HTTPS');
  });
});
