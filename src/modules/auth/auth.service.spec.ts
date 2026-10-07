import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  it('explains when Supabase has disabled new account registrations', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: {
        code: 'signup_disabled',
        message: 'Signups not allowed for this instance',
      },
    });
    const supabase = { auth: { signUp } } as unknown as SupabaseClient;
    const service = new AuthService(supabase);

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
    const supabase = { auth: { signUp } } as unknown as SupabaseClient;
    const service = new AuthService(supabase);

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
    const supabase = {
      auth: { signInWithPassword },
    } as unknown as SupabaseClient;
    const service = new AuthService(supabase);

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
    const supabase = { auth: { signUp } } as unknown as SupabaseClient;
    const service = new AuthService(supabase);

    const response = await service.register({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(signUp).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
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
    const supabase = { auth: { signUp } } as unknown as SupabaseClient;
    const service = new AuthService(supabase);

    const response = await service.register({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(response.message).toMatch(/inicia sesión/i);
  });
});
