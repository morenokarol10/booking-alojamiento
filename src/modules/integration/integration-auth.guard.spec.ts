import { UnauthorizedException } from '@nestjs/common';
import { IntegrationAuthGuard } from './integration-auth.guard';

describe('IntegrationAuthGuard API keys', () => {
  const guardWith = (settings: Record<string, string>) =>
    new IntegrationAuthGuard(
      { get: (name: string) => settings[name] } as never,
      { getAllAndOverride: () => 'alojamientos:book' } as never,
    );
  const contextWith = (apiKey: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-api-key': apiKey } }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as never;

  it('accepts the node API_KEY', async () => {
    const guard = guardWith({ API_KEY: 'node-key' });
    await expect(guard.canActivate(contextWith('node-key'))).resolves.toBe(
      true,
    );
  });

  it('accepts any key listed in INTEGRATION_API_KEYS', async () => {
    const guard = guardWith({
      API_KEY: 'node-key',
      INTEGRATION_API_KEYS: 'gateway-key, other-key',
    });
    await expect(guard.canActivate(contextWith('gateway-key'))).resolves.toBe(
      true,
    );
    await expect(guard.canActivate(contextWith('other-key'))).resolves.toBe(
      true,
    );
  });

  it('rejects unknown keys with 401', async () => {
    const guard = guardWith({ API_KEY: 'node-key' });
    await expect(guard.canActivate(contextWith('wrong'))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
