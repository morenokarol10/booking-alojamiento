import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';

@Injectable()
export class RoomCleaningScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomCleaningScheduler.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  onModuleInit() {
    this.scheduleRun();
    this.timer = setInterval(() => this.scheduleRun(), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private scheduleRun() {
    void this.completeDueCleanings().catch((error: unknown) => {
      this.logger.error(
        `No se pudieron procesar las limpiezas vencidas: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
    });
  }

  private async completeDueCleanings() {
    if (this.running) return;
    this.running = true;
    try {
      const { data, error } = await this.supabase.rpc(
        'complete_due_alojamiento_room_cleanings',
      );
      if (error) {
        this.logger.error(
          `Supabase rechazó la finalización automática de limpiezas (código: ${error.code ?? 'desconocido'}).`,
        );
        return;
      }
      if (typeof data !== 'number') {
        this.logger.error(
          'Supabase no devolvió el total de habitaciones limpiadas.',
        );
        return;
      }
      if (data > 0) {
        this.logger.log(
          `Se liberaron ${data} habitación(es) tras la limpieza.`,
        );
      }
    } finally {
      this.running = false;
    }
  }
}
