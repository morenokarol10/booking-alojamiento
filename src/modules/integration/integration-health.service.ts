import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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

interface DatabaseProbe {
  connected: boolean;
  latency: number;
  checkedAt: number;
}

/**
 * Semáforo del contrato v2.2.0: GREEN < 200 ms · YELLOW 200–800 ms ·
 * RED > 800 ms o caída.
 *
 * El Monitor de Nodos consulta cada 5 s. Si cada consulta abriera una conexión
 * TLS nueva hacia Supabase, la latencia medida sería la del handshake (no la
 * de la base de datos) y una respuesta lenta pero correcta se reportaría como
 * "DISCONNECTED". Por eso un sondeo en segundo plano mantiene la conexión
 * caliente y el endpoint responde con la última medición reciente. La base de
 * datos solo se marca DISCONNECTED cuando realmente no responde.
 */
@Injectable()
export class IntegrationHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationHealthService.name);
  private readonly startedAt = Date.now();
  private readonly databaseTimeoutMs = 3_000;
  private readonly probeIntervalMs = 4_000;
  private readonly probeMaxAgeMs = 10_000;
  private lastProbe?: DatabaseProbe;
  private inflightProbe?: Promise<DatabaseProbe>;
  private probeTimer?: NodeJS.Timeout;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  onModuleInit(): void {
    void this.probe();
    this.probeTimer = setInterval(() => {
      void this.probe();
    }, this.probeIntervalMs);
    this.probeTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.probeTimer) clearInterval(this.probeTimer);
  }

  async check(): Promise<IntegrationHealthResponse> {
    const cached = this.lastProbe;
    const probe =
      cached && Date.now() - cached.checkedAt < this.probeMaxAgeMs
        ? cached
        : await this.probe();

    if (!probe.connected) {
      return this.response('DOWN', 'RED', probe.latency, 'DISCONNECTED');
    }
    if (probe.latency < 200) {
      return this.response('HEALTHY', 'GREEN', probe.latency, 'CONNECTED');
    }
    return this.response(
      'DEGRADED',
      probe.latency <= 800 ? 'YELLOW' : 'RED',
      probe.latency,
      'CONNECTED',
    );
  }

  private probe(): Promise<DatabaseProbe> {
    this.inflightProbe ??= this.runProbe().finally(() => {
      this.inflightProbe = undefined;
    });
    return this.inflightProbe;
  }

  private async runProbe(): Promise<DatabaseProbe> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      const databaseCheck = this.supabase
        .from('alojamientos')
        .select('id')
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
      this.lastProbe = {
        connected: true,
        latency: this.latencySince(started),
        checkedAt: Date.now(),
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Unknown database error.';
      this.logger.warn(`Health check failed: ${detail}`);
      this.lastProbe = {
        connected: false,
        latency: this.latencySince(started),
        checkedAt: Date.now(),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
    return this.lastProbe;
  }

  private response(
    status: IntegrationHealthResponse['status'],
    semaforo: IntegrationHealthResponse['semaforo'],
    latency: number,
    database: IntegrationHealthResponse['database']['status'],
  ): IntegrationHealthResponse {
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
