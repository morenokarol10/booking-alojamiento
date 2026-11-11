import { IntegrationHealthService } from './integration-health.service';
import { performance } from 'node:perf_hooks';

describe('IntegrationHealthService', () => {
  const createService = (error: Error | null = null) => {
    const query = {
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ error }),
    };
    const supabase = {
      from: jest.fn().mockReturnValue(query),
    };
    return new IntegrationHealthService(supabase as never);
  };

  it('reports the database as connected when the health query succeeds', async () => {
    const service = createService();

    await expect(service.check()).resolves.toMatchObject({
      status: expect.stringMatching(/HEALTHY|DEGRADED/),
      semaforo: expect.stringMatching(/GREEN|YELLOW/),
      service: 'MS_ALOJAMIENTOS',
      vertical: 'ALOJAMIENTOS',
      database: { status: 'CONNECTED' },
    });
  });

  it('keeps a slow but reachable database as CONNECTED', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ error: null }),
    };
    const service = new IntegrationHealthService({
      from: jest.fn().mockReturnValue(query),
    } as never);
    const nowSpy = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(950);

    await expect(service.check()).resolves.toMatchObject({
      status: 'DEGRADED',
      semaforo: 'RED',
      latency_ms: 950,
      database: { status: 'CONNECTED' },
    });
    nowSpy.mockRestore();
  });

  it('reports the node as down when the health query fails', async () => {
    const service = createService(new Error('database unavailable'));

    await expect(service.check()).resolves.toMatchObject({
      status: 'DOWN',
      semaforo: 'RED',
      database: { status: 'DISCONNECTED' },
    });
  });
});
