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
      user_metadata: {
        role: 'cliente',
        full_name: 'María Pérez',
        phone: '+593991234567',
      },
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
      fullName: 'María Pérez',
      phone: '+593991234567',
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(createUser).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
      email_confirm: true,
      user_metadata: {
        role: 'cliente',
        full_name: 'María Pérez',
        phone: '+593991234567',
      },
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });
    expect(response.data.user.role).toBe('cliente');
    expect(response.data.user).toMatchObject({
      fullName: 'María Pérez',
      phone: '+593991234567',
    });
    expect(response.data.session.accessToken).toBe('access-token');
  });

  it('updates profile metadata without changing the trusted app role', async () => {
    const savedPaymentMethod = { brand: 'Visa', lastFour: '4242' };
    const getUserById = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: '50000000-0000-4000-8000-000000000001',
          user_metadata: {
            role: 'empleado',
            saved_payment_method: savedPaymentMethod,
          },
        },
      },
      error: null,
    });
    const updateUserById = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: '50000000-0000-4000-8000-000000000001',
          email: 'nuevo@example.com',
          app_metadata: { role: 'empleado' },
          user_metadata: {
            role: 'empleado',
            full_name: 'Nombre Actualizado',
            phone: '+593991111111',
            saved_payment_method: savedPaymentMethod,
          },
        },
      },
      error: null,
    });
    const service = makeService({}, { getUserById, updateUserById });

    const response = await service.updateProfile(
      {
        id: '50000000-0000-4000-8000-000000000001',
        email: 'anterior@example.com',
        role: 'empleado',
      },
      {
        fullName: 'Nombre Actualizado',
        email: 'nuevo@example.com',
        phone: '+593991111111',
      },
    );

    expect(updateUserById).toHaveBeenCalledWith(
      '50000000-0000-4000-8000-000000000001',
      expect.objectContaining({
        email: 'nuevo@example.com',
        email_confirm: true,
        user_metadata: {
          role: 'empleado',
          full_name: 'Nombre Actualizado',
          phone: '+593991111111',
          saved_payment_method: savedPaymentMethod,
        },
      }),
    );
    expect(response.data).toMatchObject({
      role: 'empleado',
      fullName: 'Nombre Actualizado',
      phone: '+593991111111',
    });
  });

  it('stores only masked card metadata and preserves existing profile metadata', async () => {
    const updateUserById = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: '50000000-0000-4000-8000-000000000001',
          email: 'cliente@example.com',
          app_metadata: {},
          user_metadata: {
            full_name: 'María Pérez',
            phone: '+593991234567',
            saved_payment_method: { brand: 'Visa', lastFour: '4242' },
          },
        },
      },
      error: null,
    });
    const service = makeService(
      {},
      {
        getUserById: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: '50000000-0000-4000-8000-000000000001',
              user_metadata: {
                full_name: 'María Pérez',
                phone: '+593991234567',
              },
            },
          },
          error: null,
        }),
        updateUserById,
      },
    );

    const response = await service.savePaymentMethod(
      {
        id: '50000000-0000-4000-8000-000000000001',
        email: 'cliente@example.com',
        role: 'cliente',
      },
      { brand: 'Visa', lastFour: '4242' },
    );

    expect(updateUserById).toHaveBeenCalledWith(
      '50000000-0000-4000-8000-000000000001',
      {
        user_metadata: {
          full_name: 'María Pérez',
          phone: '+593991234567',
          saved_payment_method: { brand: 'Visa', lastFour: '4242' },
        },
      },
    );
    expect(response.data.savedPaymentMethod).toEqual({
      brand: 'Visa',
      lastFour: '4242',
    });
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
      fullName: 'María Pérez',
      phone: '+593991234567',
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(signUp).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
      options: {
        data: {
          role: 'cliente',
          full_name: 'María Pérez',
          phone: '+593991234567',
        },
      },
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
        fullName: 'María Pérez',
        phone: '+593991234567',
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
        fullName: 'María Pérez',
        phone: '+593991234567',
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
      fullName: 'María Pérez',
      phone: '+593991234567',
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(signUp).toHaveBeenCalledWith({
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
      options: {
        data: {
          role: 'cliente',
          full_name: 'María Pérez',
          phone: '+593991234567',
        },
      },
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
      fullName: 'María Pérez',
      phone: '+593991234567',
      email: 'cliente@example.com',
      password: 'ClienteSeguro123!',
    });

    expect(response.message).toMatch(/inicia sesión/i);
  });
});
