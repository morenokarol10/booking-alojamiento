import {
  BadRequestException,
  Inject,
  InternalServerErrorException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_AUTH_CLIENT } from '../../supabase/supabase.module';
import type { AuthenticatedUser, UserRole } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
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
      throw new BadRequestException({
        statusCode: 400,
        message: 'No se pudo crear la cuenta.',
        error: error.message,
      });
    }
    if (!data.user) {
      throw new InternalServerErrorException(
        'Supabase no devolvió el usuario creado.',
      );
    }

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
        : 'Cuenta creada. Confirma tu correo para poder iniciar sesión.',
    };
  }

  async login(dto: LoginDto) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });
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
}
