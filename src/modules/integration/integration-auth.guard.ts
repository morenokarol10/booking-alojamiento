import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const INTEGRATION_SCOPE = 'integration_scope';

export const IntegrationScope = (scope: string) =>
  SetMetadata(INTEGRATION_SCOPE, scope);

@Injectable()
export class IntegrationAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const expectedScope =
      this.reflector.getAllAndOverride<string>(INTEGRATION_SCOPE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'alojamientos:read';
    const apiKey = request.headers['x-api-key'];
    const authorization = request.headers.authorization;

    if (typeof apiKey === 'string' && this.validApiKey(apiKey)) return true;

    const token =
      typeof authorization === 'string'
        ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1]
        : undefined;
    if (token) return this.validateToken(token, expectedScope);

    if (!this.configured()) {
      throw new ServiceUnavailableException(
        'La autenticación de integración no está configurada.',
      );
    }
    throw new UnauthorizedException(
      'Se requiere una credencial de integración válida.',
    );
  }

  /**
   * API_KEY es la clave del nodo (también se usa para llamar a Booking).
   * INTEGRATION_API_KEYS admite claves entrantes adicionales separadas por
   * coma, p. ej. la registrada para este nodo en el Gateway de Booking.
   */
  private acceptedApiKeys(): string[] {
    return [
      this.config.get<string>('API_KEY') ?? '',
      ...(this.config.get<string>('INTEGRATION_API_KEYS') ?? '').split(','),
    ]
      .map((key) => key.trim())
      .filter(Boolean);
  }

  private validApiKey(candidate: string): boolean {
    const supplied = candidate.trim();
    if (!supplied) return false;
    const suppliedBuffer = Buffer.from(supplied);
    return this.acceptedApiKeys().some((expected) => {
      const expectedBuffer = Buffer.from(expected);
      return (
        suppliedBuffer.length === expectedBuffer.length &&
        timingSafeEqual(suppliedBuffer, expectedBuffer)
      );
    });
  }

  private async validateToken(
    token: string,
    requiredScope: string,
  ): Promise<boolean> {
    const jwksUrl = this.config.get<string>('OAUTH_JWKS_URL');
    const issuer = this.config.get<string>('OAUTH_ISSUER');
    const audience = this.config.get<string>('OAUTH_AUDIENCE');
    if (!jwksUrl || !issuer || !audience) {
      throw new ServiceUnavailableException(
        'Falta configurar OAUTH_JWKS_URL, OAUTH_ISSUER u OAUTH_AUDIENCE.',
      );
    }

    try {
      const url = new URL(jwksUrl);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
        throw new Error('JWKS URL must use HTTPS.');
      }
      let keySet = jwksCache.get(jwksUrl);
      if (!keySet) {
        keySet = createRemoteJWKSet(url);
        jwksCache.set(jwksUrl, keySet);
      }
      const { payload } = await jwtVerify(token, keySet, {
        issuer,
        audience,
        clockTolerance: 5,
      });
      const scopes = this.claimValues(payload.scope ?? payload.scp);
      const roles = this.claimValues(payload.roles ?? payload.role);
      if (!scopes.includes(requiredScope)) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_SCOPE',
          detail: `El token no contiene el scope requerido: ${requiredScope}.`,
          scopes_requeridos: [requiredScope],
        });
      }
      if (!roles.some((role) => role === 'SERVICE' || role === 'ADMIN')) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          detail: 'El token no pertenece a un cliente de servicio autorizado.',
        });
      }
      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new UnauthorizedException('El token OAuth no es válido.');
    }
  }

  private claimValues(value: unknown): string[] {
    if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    return [];
  }

  private configured(): boolean {
    return Boolean(
      this.acceptedApiKeys().length > 0 ||
      (this.config.get<string>('OAUTH_JWKS_URL') &&
        this.config.get<string>('OAUTH_ISSUER') &&
        this.config.get<string>('OAUTH_AUDIENCE')),
    );
  }
}
