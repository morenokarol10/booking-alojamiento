import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';

/**
 * Reenvía a Booking Core los check-in que no pudieron confirmarse en el
 * momento (por ejemplo, registrados desde un servidor sin API_KEY o con
 * Booking Core caído). Como todos los nodos comparten Supabase, el que sí
 * tiene la clave termina la confirmación en segundos.
 */
@Injectable()
export class BookingCheckinRetryScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BookingCheckinRetryScheduler.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private readonly reservations: ReservationsService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const confirmed = await this.reservations.retryPendingBookingCheckins();
      if (confirmed > 0) {
        this.logger.log(
          `${confirmed} check-in pendiente(s) confirmados a Booking Core.`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudieron reintentar los check-in pendientes: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
