import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');
export const SUPABASE_AUTH_CLIENT = Symbol('SUPABASE_AUTH_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): SupabaseClient => {
        const url = configService.getOrThrow<string>('SUPABASE_URL');
        const key = configService.getOrThrow<string>(
          'SUPABASE_SERVICE_ROLE_KEY',
        );

        if (!url.trim() || !key.trim()) {
          throw new Error(
            'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must not be empty.',
          );
        }

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
        const url = configService.getOrThrow<string>('SUPABASE_URL');
        const key = configService.getOrThrow<string>('SUPABASE_KEY');

        if (!url.trim() || !key.trim()) {
          throw new Error('SUPABASE_URL and SUPABASE_KEY must not be empty.');
        }

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
