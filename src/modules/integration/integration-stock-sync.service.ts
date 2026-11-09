import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import type { ChannelModel, ConfirmChannel, Message } from 'amqplib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';

type StockData = {
  alojamientoId?: string;
  tipoHabitacionCodigo?: string;
  fecha?: string;
  unidadesDisponibles?: number;
  reason?: string;
};

type OutboxStockEvent = {
  id: string;
  data: StockData;
};

@Injectable()
export class IntegrationStockSyncService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IntegrationStockSyncService.name);
  private readonly serviceId: string;
  private readonly exchange: string;
  private readonly routingKey: string;
  private readonly mode: 'rabbitmq' | 'disabled';
  private readonly rabbitUrl?: string;
  private readonly returnedMessages = new Set<string>();
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private interval?: NodeJS.Timeout;
  private dispatching = false;
  private lastConnectionWarningAt = 0;
  private nextConnectionAttemptAt = 0;
  private connectionAttempts = 0;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
  ) {
    this.serviceId =
      this.config.get<string>('INVENTORY_SERVICE_ID') ??
      this.config.get<string>('NODE_ID') ??
      'NODE_ALO';
    this.exchange =
      this.config.get<string>('RABBITMQ_EXCHANGE') ?? 'booking.events';
    this.routingKey =
      this.config.get<string>('RABBITMQ_ROUTING_KEY') ?? 'stock.updated';
    const rabbitUrl = this.config.get<string>('RABBITMQ_URL')?.trim();
    this.rabbitUrl = rabbitUrl || undefined;
    if (this.rabbitUrl) this.validateRabbitUrl(this.rabbitUrl);
    const mode = this.config.get<string>('EVENT_BUS_MODE') ?? 'rabbitmq';
    if (mode !== 'rabbitmq' && mode !== 'disabled') {
      throw new Error('EVENT_BUS_MODE must be "rabbitmq" or "disabled".');
    }
    this.mode = mode;
  }

  onModuleInit(): void {
    if (this.mode === 'disabled') {
      this.logger.warn(
        'EVENT_BUS_MODE=disabled; stock updates will remain in the Outbox.',
      );
      return;
    }

    if (!this.rabbitUrl) {
      this.logger.warn(
        'RABBITMQ_URL is not configured; stock updates will remain in the Outbox.',
      );
      return;
    }

    this.startDispatcher();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }

  private startDispatcher(): void {
    void this.dispatch().catch((error: unknown) =>
      this.logDispatchError(error),
    );
    this.interval = setInterval(() => {
      void this.dispatch().catch((error: unknown) =>
        this.logDispatchError(error),
      );
    }, 1000);
    this.interval.unref();
  }

  private async dispatch(): Promise<void> {
    if (this.dispatching || this.mode !== 'rabbitmq') return;
    this.dispatching = true;
    try {
      const channel = await this.getChannel();
      if (!channel) return;

      const { data, error } = await this.supabase.rpc(
        'claim_alojamiento_stock_outbox',
        { p_limit: 10 },
      );
      if (error) {
        throw new ServiceUnavailableException(
          `No se pudieron reclamar eventos de stock (${error.code ?? 'error de base de datos'}).`,
        );
      }

      for (const row of (data ?? []) as OutboxStockEvent[]) {
        try {
          await this.publish(channel, row);
          await this.markDelivered(row.id, true);
        } catch (error) {
          await this.markDelivered(row.id, false, this.errorMessage(error));
          this.logger.error(
            `No se pudo sincronizar el evento de stock ${row.id}: ${this.errorMessage(error)}`,
          );
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async getChannel(): Promise<ConfirmChannel | undefined> {
    if (this.channel) return this.channel;

    const now = Date.now();
    if (now < this.nextConnectionAttemptAt) return undefined;
    if (!this.rabbitUrl) return undefined;

    let connection: ChannelModel | undefined;
    let channel: ConfirmChannel | undefined;
    try {
      const connectionUrl = new URL(this.rabbitUrl);
      connectionUrl.searchParams.set('heartbeat', '30');
      const connected = await amqp.connect(connectionUrl.toString());
      const confirmChannel = await connected.createConfirmChannel();
      connection = connected;
      channel = confirmChannel;
      await confirmChannel.assertExchange(this.exchange, 'topic', {
        durable: true,
      });

      connected.on('error', (error: Error) => {
        this.invalidateConnection(connected, confirmChannel);
        this.warnConnection(error);
      });
      connected.on('close', () =>
        this.invalidateConnection(connected, confirmChannel),
      );
      confirmChannel.on('return', (message: Message) => {
        const id = message.properties.messageId;
        if (id) this.returnedMessages.add(id);
      });
      confirmChannel.on('error', (error: Error) => {
        this.invalidateConnection(connected, confirmChannel);
        this.warnConnection(error);
      });
      confirmChannel.on('close', () =>
        this.invalidateConnection(connected, confirmChannel),
      );

      this.connection = connected;
      this.channel = confirmChannel;
      this.connectionAttempts = 0;
      this.nextConnectionAttemptAt = 0;
      return confirmChannel;
    } catch (error) {
      await channel?.close().catch(() => undefined);
      await connection?.close().catch(() => undefined);
      this.connectionAttempts += 1;
      const delaySeconds = Math.min(2 ** (this.connectionAttempts - 1), 60);
      this.nextConnectionAttemptAt = Date.now() + delaySeconds * 1000;
      this.warnConnection(error);
      return undefined;
    }
  }

  private validateRabbitUrl(value: string): void {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value);
    } catch {
      throw new Error('RABBITMQ_URL must be a valid AMQP URL.');
    }

    if (
      !['amqp:', 'amqps:'].includes(parsedUrl.protocol) ||
      !parsedUrl.hostname
    ) {
      throw new Error('RABBITMQ_URL must use the amqp:// or amqps:// scheme.');
    }
    if (
      this.config.get<string>('NODE_ENV') === 'production' &&
      parsedUrl.protocol !== 'amqps:'
    ) {
      throw new Error('Production RABBITMQ_URL must use amqps://.');
    }
  }

  private async publish(
    channel: ConfirmChannel,
    event: OutboxStockEvent,
  ): Promise<void> {
    const data = event.data;
    if (
      !data.alojamientoId ||
      !data.tipoHabitacionCodigo ||
      !data.fecha ||
      typeof data.unidadesDisponibles !== 'number' ||
      !Number.isInteger(data.unidadesDisponibles) ||
      data.unidadesDisponibles < 0 ||
      !data.reason
    ) {
      throw new Error('El evento de stock contiene datos incompletos.');
    }

    const payload = {
      service_id: this.serviceId,
      item_id: `${data.alojamientoId}:${data.tipoHabitacionCodigo}`,
      available_units: data.unidadesDisponibles,
      date: data.fecha,
      reason: data.reason,
    };
    const message = Buffer.from(JSON.stringify(payload));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.returnedMessages.delete(event.id);
        reject(new Error('RabbitMQ publisher confirmation timed out.'));
      }, 10_000);
      channel.publish(
        this.exchange,
        this.routingKey,
        message,
        {
          contentType: 'application/json',
          deliveryMode: 2,
          mandatory: true,
          messageId: event.id,
          type: this.routingKey,
        },
        (error) => {
          clearTimeout(timer);
          if (this.returnedMessages.delete(event.id)) {
            reject(
              new Error(
                `RabbitMQ exchange "${this.exchange}" has no queue bound to "${this.routingKey}".`,
              ),
            );
          } else if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
    });
  }

  private invalidateConnection(
    connection: ChannelModel,
    channel: ConfirmChannel,
  ): void {
    if (this.connection !== connection) return;
    this.connection = undefined;
    this.channel = undefined;
    this.nextConnectionAttemptAt = 0;
    void channel.close().catch(() => undefined);
    void connection.close().catch(() => undefined);
  }

  private warnConnection(error: unknown): void {
    const now = Date.now();
    if (now - this.lastConnectionWarningAt < 30_000) return;
    this.lastConnectionWarningAt = now;
    this.logger.warn(
      `RabbitMQ is unavailable; stock events remain in the Outbox: ${this.errorMessage(error)}`,
    );
  }

  private async markDelivered(
    id: string,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    const { data, error } = await this.supabase.rpc(
      'finish_alojamiento_stock_outbox',
      {
        p_outbox_id: id,
        p_success: success,
        p_error: errorMessage ?? null,
      },
    );
    if (error || data !== true) {
      throw new ServiceUnavailableException(
        `No se pudo confirmar el evento de stock ${id} (${error?.code ?? 'evento inexistente'}).`,
      );
    }
  }

  private logDispatchError(error: unknown): void {
    this.logger.error(
      `No se pudo procesar la Outbox de stock: ${this.errorMessage(error)}`,
    );
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message.slice(0, 500);
    return 'Error desconocido al publicar el evento.';
  }
}
