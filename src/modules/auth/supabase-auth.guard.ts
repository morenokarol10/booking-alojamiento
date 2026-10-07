import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_AUTH_CLIENT } from '../../supabase/supabase.module';
import type { AuthenticatedRequest, UserRole } from './auth.types';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_AUTH_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(/\s+/, 2) ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Se requiere un token Bearer válido.');
    }

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('El token de acceso no es válido.');
    }

    const role: UserRole =
      data.user.app_metadata?.role === 'admin' ? 'admin' : 'cliente';
    request.user = {
      id: data.user.id,
      email: data.user.email ?? '',
      role,
    };
    return true;
  }
}
