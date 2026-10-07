import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RolesGuard } from './roles.guard';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import type { AuthenticatedRequest } from './auth.types';

function httpContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SupabaseAuthGuard', () => {
  it('uses only trusted app_metadata for roles', async () => {
    const request: AuthenticatedRequest = {
      headers: { authorization: 'Bearer valid-token' },
    };
    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-id',
              email: 'user@example.com',
              app_metadata: {},
              user_metadata: { role: 'admin' },
            },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;
    const guard = new SupabaseAuthGuard(supabase);

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-id',
      email: 'user@example.com',
      role: 'cliente',
    });
  });

  it('accepts an admin role assigned in app_metadata', async () => {
    const request: AuthenticatedRequest = {
      headers: { authorization: 'Bearer valid-token' },
    };
    const supabase = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: 'admin-id',
              email: 'admin@example.com',
              app_metadata: { role: 'admin' },
            },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;
    const guard = new SupabaseAuthGuard(supabase);

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request.user?.role).toBe('admin');
  });

  it('rejects requests without a bearer token', async () => {
    const getUser = jest.fn();
    const supabase = {
      auth: { getUser },
    } as unknown as SupabaseClient;
    const guard = new SupabaseAuthGuard(supabase);

    await expect(
      guard.canActivate(httpContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe('RolesGuard', () => {
  it('rejects a customer on admin routes', () => {
    const reflector = {
      getAllAndOverride: () => ['admin'],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          user: {
            id: 'customer-id',
            email: 'client@example.com',
            role: 'cliente',
          },
        }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
