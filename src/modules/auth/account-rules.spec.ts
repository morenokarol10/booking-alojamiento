import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RegisterDto } from './dto/register.dto';
import { assertCedulaAvailable, PASSWORD_PATTERN } from './account-rules';

describe('Account rules', () => {
  it.each([
    ['Cliente1!', true],
    ['Corta1!', false],
    ['sinmayuscula1!', false],
    ['SinNumero!!', false],
    ['SinEspecial1', false],
  ])('password %s valid=%s', (password, valid) => {
    expect(PASSWORD_PATTERN.test(password)).toBe(valid);
  });

  const registration = (overrides: Record<string, unknown> = {}) =>
    plainToInstance(RegisterDto, {
      fullName: 'Juan López',
      phone: '0991234567',
      email: 'juanlopez@gmail.com',
      password: 'Cliente1!',
      cedula: '1600222176',
      ...overrides,
    });

  it('accepts a registration with a valid Ecuadorian cédula', async () => {
    await expect(validate(registration())).resolves.toEqual([]);
  });

  it('rejects an invalid cédula and a weak password', async () => {
    const errors = await validate(
      registration({ cedula: '1600222170', password: 'password' }),
    );
    expect(errors.map((error) => error.property).sort()).toEqual([
      'cedula',
      'password',
    ]);
  });

  it('refuses a cédula already used by another account', async () => {
    const client = {
      auth: {
        admin: {
          listUsers: jest.fn().mockResolvedValue({
            data: {
              users: [{ id: 'other', user_metadata: { cedula: '1600222176' } }],
            },
            error: null,
          }),
        },
      },
    } as unknown as SupabaseClient;

    await expect(
      assertCedulaAvailable(client, '1600222176'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      assertCedulaAvailable(client, '1600222176', 'other'),
    ).resolves.toBeUndefined();
  });
});
