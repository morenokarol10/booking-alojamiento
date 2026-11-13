import { applyDecorators, ConflictException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import { isValidGuestDocument } from '../integration/integration-document-validator';

/** Mínimo 8 caracteres con al menos una mayúscula, un número y un símbolo. */
export const PASSWORD_PATTERN =
  /^(?=.*[A-ZÁÉÍÓÚÑ])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,72}$/;
export const PASSWORD_RULES_MESSAGE =
  'La contraseña debe tener al menos 8 caracteres, una letra mayúscula, un número y un carácter especial (por ejemplo ! @ # $ %).';

export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: PASSWORD_RULES_MESSAGE }),
    MaxLength(72),
    Matches(PASSWORD_PATTERN, { message: PASSWORD_RULES_MESSAGE }),
  );
}

/** Cédula ecuatoriana de 10 dígitos con dígito verificador válido. */
export function IsEcuadorianCedula(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEcuadorianCedula',
      target: object.constructor,
      propertyName,
      options: {
        message: 'La cédula ecuatoriana no es válida (10 dígitos).',
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          isValidGuestDocument('CEDULA', value.trim()),
      },
    });
  };
}

/**
 * Comprueba que ninguna otra cuenta tenga la misma cédula (se guarda en
 * user_metadata.cedula de Supabase Auth).
 */
export async function assertCedulaAvailable(
  adminClient: SupabaseClient,
  cedula: string,
  exceptUserId?: string,
) {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) return; // No bloquear el registro si Auth no responde.
    const users = data?.users ?? [];
    const taken = users.find(
      (user) =>
        user.id !== exceptUserId &&
        String(user.user_metadata?.cedula ?? '').trim() === cedula,
    );
    if (taken) {
      throw new ConflictException(
        'Ya existe una cuenta registrada con esa cédula.',
      );
    }
    if (users.length < perPage) return;
  }
}
