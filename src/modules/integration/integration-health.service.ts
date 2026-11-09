import { Inject, Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.module';

export interface IntegrationHealthResponse {
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  semaforo: 'GREEN' | 'YELLOW' | 'RED';
  service: 'MS_ALOJAMIENTOS';
  version: '2.2.0';
  nodo_id: string;
  vertical: 'ALOJAMIENTOS';
  latency_ms: number;
  uptime_seconds: number;
  database: {
    status: 'CONNECTED' | 'DISCONNECTED';
  };
  timestamp: string;
}

@Injectable()
export class IntegrationHealthService {
  private readonly logger = new Logger(IntegrationHealthService.name);
  private readonly startedAt = Date.now();
  private readonly databaseTimeoutMs = 800;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async check(): Promise<IntegrationHealthResponse> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      const databaseCheck = this.supabase
        .from('alojamientos')
        .select('id', { head: true, count: 'exact' })
        .limit(1)
        .then(({ error }) => {
          if (error) throw error;
        });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Database health check timed out.')),
          this.databaseTimeoutMs,
        );
      });

      await Promise.race([databaseCheck, timeout]);
      const latency = this.latencySince(started);
      const degraded = latency >= 200;

      return this.response({
        status: degraded ? 'DEGRADED' : 'HEALTHY',
        semaforo: degraded ? 'YELLOW' : 'GREEN',
        latency,
        database: 'CONNECTED',
      });
    } catch (error) {
      const latency = this.latencySince(started);
      const detail =
        error instanceof Error ? error.message : 'Unknown database error.';
      this.logger.warn(`Health check failed: ${detail}`);

      return this.response({
        status: 'DOWN',
        semaforo: 'RED',
        latency,
        database: 'DISCONNECTED',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private response({
    status,
    semaforo,
    latency,
    database,
  }: {
    status: IntegrationHealthResponse['status'];
    semaforo: IntegrationHealthResponse['semaforo'];
    latency: number;
    database: IntegrationHealthResponse['database']['status'];
  }): IntegrationHealthResponse {
    return {
      status,
      semaforo,
      service: 'MS_ALOJAMIENTOS',
      version: '2.2.0',
      nodo_id: process.env.NODE_ID ?? 'NODE_ALO_LOCAL',
      vertical: 'ALOJAMIENTOS',
      latency_ms: latency,
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
      database: { status: database },
      timestamp: new Date().toISOString(),
    };
  }

  private latencySince(started: number): number {
    return Math.max(0, Math.round(performance.now() - started));
  }
}
