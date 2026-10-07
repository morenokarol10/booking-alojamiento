import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthService } from './auth.service';

describe('AuthService', () => {
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
