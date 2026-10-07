import {
  BadRequestException,
  Inject,
  InternalServerErrorException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_AUTH_CLIENT } from '../../supabase/supabase.module';
import type { AuthenticatedUser, UserRole } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(SUPABASE_AUTH_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async register(dto: RegisterDto) {
    const { data, error } = await this.supabase.auth.signUp({
      email: dto.email,
      password: dto.password,
    });
    if (error) {
      this.logger.warn(
        `Supabase Auth rechazó el registro (código: ${error.code ?? 'desconocido'}).`,
      );
      throw new BadRequestException({
        statusCode: 400,
        message: this.getRegistrationErrorMessage(error.code),
        error: error.code ?? 'supabase_auth_error',
      });
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
        'La cuenta existe, pero el correo aún no está confirmado. Revisa tu bandeja de entrada o solicita recuperar la contraseña.',
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

  private mapUser(user: User): AuthenticatedUser {
    const role: UserRole =
      user.app_metadata?.role === 'admin' ? 'admin' : 'cliente';
    return {
      id: user.id,
      email: user.email ?? '',
      role,
    };
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
}
