import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const makeService = (
    auth: Record<string, unknown>,
    admin: Record<string, unknown> = {},
    autoConfirm = false,
  ) =>
    new AuthService(
      { auth } as unknown as SupabaseClient,
      { auth: { admin } } as unknown as SupabaseClient,
      {
        get: () => (autoConfirm ? 'true' : 'false'),
      } as unknown as ConfigService,
    );

  it('auto-confirms evaluation accounts, assigns cliente metadata and returns a session', async () => {
    const user = {
      id: '50000000-0000-4000-8000-000000000001',
      email: 'cliente@example.com',
      app_metadata: {},
      user_metadata: { role: 'cliente' },
      identities: [{ id: 'identity-1' }],
    };
    const createUser = jest.fn().mockResolvedValue({
      data: { user },
      error: null,
    });
    const session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 1_800_000_000,
      token_type: 'bearer',
    };
    const signInWithPassword = jest.fn().mockResolvedValue({
      data: { user, session },
      error: null,
    });
    const service = makeService({ signInWithPassword }, { createUser }, true);

    const response = await service.register({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(createUser).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
      email_confirm: true,
      user_metadata: { role: 'cliente' },
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });
    expect(response.data.user.role).toBe('cliente');
    expect(response.data.session.accessToken).toBe('access-token');
  });

  it('uses Supabase signUp with cliente metadata when auto-confirm is disabled', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: '50000000-0000-4000-8000-000000000001',
          email: 'cliente@example.com',
          app_metadata: {},
          identities: [{ id: 'identity-1' }],
        },
        session: null,
      },
      error: null,
    });
    const service = makeService({ signUp });

    await service.register({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(signUp).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
      options: { data: { role: 'cliente' } },
    });
  });

  it('explains when Supabase has disabled new account registrations', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: {
        code: 'signup_disabled',
        message: 'Signups not allowed for this instance',
      },
    });
    const service = makeService({ signUp });

    await expect(
      service.register({
        email: 'cliente@example.com',
        password: 'ClienteSeguro123!',
      }),
    ).rejects.toThrow(/registro está deshabilitado en Supabase/i);
  });

  it('explains when Supabase is rate-limiting confirmation emails', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: {
        code: 'over_email_send_rate_limit',
        message: 'Email rate limit exceeded',
      },
    });
    const service = makeService({ signUp });

    await expect(
      service.register({
        email: 'cliente@example.com',
        password: 'ClienteSeguro123!',
      }),
    ).rejects.toThrow(/limitó temporalmente el envío de correos/i);
  });

  it('explains when login fails because the email is not confirmed', async () => {
    const signInWithPassword = jest.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: {
        code: 'email_not_confirmed',
        message: 'Email not confirmed',
      },
    });
    const service = makeService({ signInWithPassword });

    await expect(
      service.login({
        email: 'cliente@example.com',
        password: 'ClienteSeguro123!',
      }),
    ).rejects.toThrow(/correo aún no está confirmado/i);
  });

  it('reports email confirmation when Supabase creates an unconfirmed account', async () => {
    const user = {
      id: '50000000-0000-4000-8000-000000000001',
      email: 'cliente@example.com',
      app_metadata: {},
      identities: [{ id: 'identity-1' }],
    };
    const signUp = jest.fn().mockResolvedValue({
      data: { user, session: null },
      error: null,
    });
    const service = makeService({ signUp });

    const response = await service.register({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(signUp).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
      options: { data: { role: 'cliente' } },
    });
    expect(response.data.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: 'cliente',
    });
    expect(response.data.session).toBeNull();
    expect(response.message).toMatch(/confirma el correo/i);
  });

  it('does not claim a new account was created when the email already exists', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: '50000000-0000-4000-8000-000000000001',
          email: 'cliente@example.com',
          app_metadata: {},
          identities: [],
        },
      },
      session: null,
      error: null,
    });
    const service = makeService({ signUp });

    const response = await service.register({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(response.message).toMatch(/inicia sesión/i);
  });
});
