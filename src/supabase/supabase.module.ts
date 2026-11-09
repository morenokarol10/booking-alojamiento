import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');
export const SUPABASE_AUTH_CLIENT = Symbol('SUPABASE_AUTH_CLIENT');

function requiredSetting(configService: ConfigService, name: string): string {
  const value = configService.getOrThrow<string>(name).trim();
  if (!value) {
    throw new Error(`${name} must not be empty.`);
  }
  return value;
}

function supabaseUrl(configService: ConfigService): string {
  const value = requiredSetting(configService, 'SUPABASE_URL');
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SUPABASE_URL must be an absolute HTTP or HTTPS URL.');
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('SUPABASE_URL must be an absolute HTTP or HTTPS URL.');
  }

  return value;
}

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): SupabaseClient => {
        const url = supabaseUrl(configService);
        const key = requiredSetting(
          configService,
          'SUPABASE_SERVICE_ROLE_KEY',
        );

        return createClient(url, key, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });
      },
    },
    {
      provide: SUPABASE_AUTH_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): SupabaseClient => {
        const url = supabaseUrl(configService);
        const key = requiredSetting(configService, 'SUPABASE_KEY');

        return createClient(url, key, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });
      },
    },
  ],
  exports: [SUPABASE_CLIENT, SUPABASE_AUTH_CLIENT],
})
export class SupabaseModule {}
