import {
  BadRequestException,
  Inject,
  InternalServerErrorException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  SUPABASE_AUTH_CLIENT,
  SUPABASE_CLIENT,
} from '../../supabase/supabase.module';
import type {
  AuthenticatedUser,
  SavedPaymentMethod,
  UserRole,
} from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(SUPABASE_AUTH_CLIENT)
    private readonly supabase: SupabaseClient,
    @Inject(SUPABASE_CLIENT)
    private readonly adminSupabase: SupabaseClient,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    if (
      this.configService
        .get<string>('SUPABASE_AUTH_AUTO_CONFIRM_SIGNUPS')
        ?.toLowerCase() === 'true'
    ) {
      return this.registerAutoConfirmed(dto);
    }

    const { data, error } = await this.supabase.auth.signUp({
      email: dto.email,
      password: dto.password,
      options: {
        data: {
          role: 'cliente',
          full_name: dto.fullName.trim(),
          phone: dto.phone.trim(),
        },
      },
    });
    if (error) {
      this.throwRegistrationError(error.code);
    }
    if (!data.user) {
      throw new InternalServerErrorException(
        'Supabase no devolvió el usuario creado.',
      );
    }
    const accountAlreadyExists = data.user.identities?.length === 0;

    return {
      data: {
        user: this.mapUser(data.user),
        session: data.session
          ? {
              accessToken: data.session.access_token,
              refreshToken: data.session.refresh_token,
              expiresAt: data.session.expires_at,
              tokenType: data.session.token_type,
            }
          : null,
      },
      message: data.session
        ? 'Cuenta de cliente creada correctamente.'
        : accountAlreadyExists
          ? 'No se pudo crear una cuenta nueva con ese correo. Si ya te registraste, inicia sesión; si no, revisa el correo ingresado.'
          : 'La cuenta se registró en Supabase Auth. Confirma el correo enviado por Supabase antes de iniciar sesión.',
    };
  }

  async login(dto: LoginDto) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });
    if (error?.code === 'email_not_confirmed') {
      throw new UnauthorizedException(
        'Esta cuenta de prueba aún no está confirmada. En Supabase, ve a Authentication > Users, abre el usuario y confirma su correo. Los registros nuevos se confirman automáticamente cuando SUPABASE_AUTH_AUTO_CONFIRM_SIGNUPS=true está activo en Render.',
      );
    }
    if (error || !data.user || !data.session) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    return {
      data: {
        user: this.mapUser(data.user),
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
          tokenType: data.session.token_type,
        },
      },
      message: 'Sesión iniciada correctamente.',
    };
  }

  getProfile(user: AuthenticatedUser) {
    return { data: user, message: 'Sesión válida.' };
  }

  async updateProfile(user: AuthenticatedUser, dto: UpdateProfileDto) {
    const existing = await this.getUserForProfileUpdate(user.id);
    const { data, error } = await this.adminSupabase.auth.admin.updateUserById(
      user.id,
      {
        email: dto.email.trim(),
        email_confirm: true,
        user_metadata: {
          ...existing.user_metadata,
          role: user.role,
          full_name: dto.fullName.trim(),
          phone: dto.phone.trim(),
        },
      },
    );
    if (error) {
      this.logger.warn(
        `No se pudo actualizar el perfil ${user.id} (código: ${error.code ?? 'desconocido'}).`,
      );
      throw new BadRequestException(
        'No se pudo actualizar el perfil. Verifica que el correo no esté en uso e inténtalo de nuevo.',
      );
    }
    if (!data.user) {
      throw new InternalServerErrorException(
        'Supabase no devolvió el usuario actualizado.',
      );
    }

    return {
      data: this.mapUser(data.user),
      message: 'Perfil actualizado correctamente.',
    };
  }

  async savePaymentMethod(
    user: AuthenticatedUser,
    paymentMethod: SavedPaymentMethod,
  ) {
    const existing = await this.getUserForProfileUpdate(user.id);
    const { data, error } = await this.adminSupabase.auth.admin.updateUserById(
      user.id,
      {
        user_metadata: {
          ...existing.user_metadata,
          saved_payment_method: paymentMethod,
        },
      },
    );
    if (error || !data.user) {
      this.logger.warn(
        `No se pudo guardar la tarjeta de prueba para ${user.id} (código: ${error?.code ?? 'desconocido'}).`,
      );
      throw new InternalServerErrorException(
        'No se pudo guardar la referencia segura de la tarjeta de prueba.',
      );
    }
    return {
      data: { savedPaymentMethod: paymentMethod },
      message:
        'Se guardó la marca y los últimos cuatro dígitos. No se almacenó ningún número completo ni CVV.',
    };
  }

  private async getUserForProfileUpdate(userId: string) {
    const { data, error } =
      await this.adminSupabase.auth.admin.getUserById(userId);
    if (error || !data.user) {
      this.logger.warn(
        `No se pudo consultar el perfil ${userId} antes de actualizarlo (código: ${error?.code ?? 'desconocido'}).`,
      );
      throw new InternalServerErrorException(
        'No se pudo consultar el perfil antes de actualizarlo.',
      );
    }
    return data.user;
  }

  private mapUser(user: User): AuthenticatedUser {
    const role: UserRole =
      user.app_metadata?.role === 'admin'
        ? 'admin'
        : user.app_metadata?.role === 'empleado'
          ? 'empleado'
          : 'cliente';
    const fullName = this.metadataString(user.user_metadata, [
      'full_name',
      'fullName',
      'name',
      'nombre',
    ]);
    const phone = this.metadataString(user.user_metadata, [
      'phone',
      'phone_number',
      'telefono',
    ]);
    const savedPaymentMethod = this.savedPaymentMethod(
      user.user_metadata?.saved_payment_method,
    );
    return {
      id: user.id,
      email: user.email ?? '',
      role,
      ...(fullName ? { fullName } : {}),
      ...(phone ? { phone } : {}),
      ...(savedPaymentMethod ? { savedPaymentMethod } : {}),
    };
  }

  private savedPaymentMethod(value: unknown): SavedPaymentMethod | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const method = value as Record<string, unknown>;
    if (
      (method.brand !== 'Visa' &&
        method.brand !== 'Mastercard' &&
        method.brand !== 'Demo') ||
      typeof method.lastFour !== 'string' ||
      !/^\d{4}$/.test(method.lastFour)
    ) {
      return undefined;
    }
    return { brand: method.brand, lastFour: method.lastFour };
  }

  private metadataString(
    metadata: User['user_metadata'],
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = metadata?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private getRegistrationErrorMessage(code: string | undefined): string {
    switch (code) {
      case 'signup_disabled':
        return 'El registro está deshabilitado en Supabase. En Authentication > Settings, habilita la opción para permitir nuevos usuarios.';
      case 'email_exists':
      case 'user_already_exists':
        return 'Ese correo ya tiene una cuenta. Inicia sesión o usa la recuperación de contraseña.';
      case 'weak_password':
        return 'La contraseña no cumple los requisitos de Supabase. Usa al menos 12 caracteres y combina letras y números.';
      case 'over_email_send_rate_limit':
        return 'Supabase limitó temporalmente el envío de correos de confirmación. Espera unos minutos antes de intentarlo de nuevo.';
      case 'email_address_invalid':
        return 'Supabase rechazó el formato o dominio del correo. Revisa la dirección e inténtalo de nuevo.';
      default:
        return `Supabase no pudo registrar la cuenta (código: ${code ?? 'desconocido'}). Verifica la configuración de Authentication y el proyecto Supabase conectado en Render.`;
    }
  }

  private async registerAutoConfirmed(dto: RegisterDto) {
    const { data, error } = await this.adminSupabase.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
      user_metadata: {
        role: 'cliente',
        full_name: dto.fullName.trim(),
        phone: dto.phone.trim(),
      },
    });
    if (error) {
      this.throwRegistrationError(error.code);
    }
    if (!data.user) {
      throw new InternalServerErrorException(
        'Supabase no devolvió el usuario creado.',
      );
    }

    const user = this.mapUser(data.user);
    const { data: sessionData, error: loginError } =
      await this.supabase.auth.signInWithPassword({
        email: dto.email,
        password: dto.password,
      });
    if (loginError || !sessionData.user || !sessionData.session) {
      this.logger.warn(
        `Se creó la cuenta de cliente, pero no se pudo iniciar sesión automáticamente (código: ${loginError?.code ?? 'desconocido'}).`,
      );
      return {
        data: { user, session: null },
        message:
          'La cuenta se creó y confirmó correctamente. Inicia sesión con el correo y la contraseña registrados.',
      };
    }

    return {
      data: {
        user: this.mapUser(sessionData.user),
        session: {
          accessToken: sessionData.session.access_token,
          refreshToken: sessionData.session.refresh_token,
          expiresAt: sessionData.session.expires_at,
          tokenType: sessionData.session.token_type,
        },
      },
      message: 'Cuenta de cliente creada correctamente.',
    };
  }

  private throwRegistrationError(code: string | undefined): never {
    this.logger.warn(
      `Supabase Auth rechazó el registro (código: ${code ?? 'desconocido'}).`,
    );
    throw new BadRequestException({
      statusCode: 400,
      message: this.getRegistrationErrorMessage(code),
      error: code ?? 'supabase_auth_error',
    });
  }
}
