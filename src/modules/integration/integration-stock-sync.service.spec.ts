import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel } from 'amqplib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IntegrationStockSyncService } from './integration-stock-sync.service';

describe('IntegrationStockSyncService', () => {
  function createService() {
    const config = {
      get: (name: string) =>
        ({
          INVENTORY_SERVICE_ID: 'NODE_ALO_TEST',
          RABBITMQ_EXCHANGE: 'booking.events',
          RABBITMQ_ROUTING_KEY: 'stock.updated',
          EVENT_BUS_MODE: 'rabbitmq',
        })[name],
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
});
