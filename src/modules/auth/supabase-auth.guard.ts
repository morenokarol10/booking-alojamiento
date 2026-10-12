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

    const appRole = data.user.app_metadata?.role;
    const role: UserRole =
      appRole === 'admin' || appRole === 'empleado' ? appRole : 'cliente';
    const metadata = data.user.user_metadata;
    const fullName = this.metadataString(metadata, [
      'full_name',
      'fullName',
      'name',
      'nombre',
    ]);
    const phone = this.metadataString(metadata, [
      'phone',
      'phone_number',
      'telefono',
    ]);
    request.user = {
      id: data.user.id,
      email: data.user.email ?? '',
      role,
      ...(fullName ? { fullName } : {}),
      ...(phone ? { phone } : {}),
    };
    return true;
  }

  private metadataString(
    metadata: Record<string, unknown> | undefined,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = metadata?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }
}
