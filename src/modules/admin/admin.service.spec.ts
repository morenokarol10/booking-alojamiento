import type { SupabaseClient } from '@supabase/supabase-js';
import { ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService account management', () => {
  it('creates active accounts with the requested trusted app role', async () => {
    const user = {
      id: '50000000-0000-4000-8000-000000000001',
      email: 'staff@example.com',
      app_metadata: { role: 'empleado' },
      user_metadata: {
        full_name: 'Personal de prueba',
        phone: '+593991234567',
      },
      email_confirmed_at: '2026-10-11T00:00:00.000Z',
    };
    const createUser = jest.fn().mockResolvedValue({
      data: { user },
      error: null,
    });
    const service = new AdminService({
      auth: { admin: { createUser } },
    } as unknown as SupabaseClient);

    const response = await service.createUser({
      fullName: 'Personal de prueba',
      phone: '+593991234567',
      email: 'staff@example.com',
      password: 'UsuarioSeguro123!',
      role: 'empleado',
    });

    expect(createUser).toHaveBeenCalledWith({
      email: 'staff@example.com',
      password: 'UsuarioSeguro123!',
      email_confirm: true,
      app_metadata: { role: 'empleado' },
      user_metadata: {
        full_name: 'Personal de prueba',
        phone: '+593991234567',
      },
    });
    expect(response.data.role).toBe('empleado');
    expect(response.data.emailConfirmed).toBe(true);
  });

  it('prevents administrators from changing their own role', async () => {
    const service = new AdminService({} as SupabaseClient);
    await expect(
      service.updateUserRole('admin-id', 'cliente', 'admin-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
