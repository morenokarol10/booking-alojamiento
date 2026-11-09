import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  SUPABASE_AUTH_CLIENT,
  SUPABASE_CLIENT,
  SupabaseModule,
} from './supabase.module';

describe('SupabaseModule configuration', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('creates both clients from their separate configured keys', async () => {
    moduleRef = await createModule({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_KEY: 'public-key',
      SUPABASE_SERVICE_ROLE_KEY: 'server-key',
    });

    expect(moduleRef.get(SUPABASE_CLIENT)).toBeDefined();
    expect(moduleRef.get(SUPABASE_AUTH_CLIENT)).toBeDefined();
  });

  it('rejects a malformed Supabase URL during startup', async () => {
    await expect(
      createModule({
        SUPABASE_URL: 'not-a-url',
        SUPABASE_KEY: 'public-key',
        SUPABASE_SERVICE_ROLE_KEY: 'server-key',
      }),
    ).rejects.toThrow(
      'SUPABASE_URL must be an absolute HTTP or HTTPS URL.',
    );
  });

  it('rejects blank Supabase keys during startup', async () => {
    await expect(
      createModule({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_KEY: 'public-key',
        SUPABASE_SERVICE_ROLE_KEY: ' ',
      }),
    ).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY must not be empty.');
  });

  async function createModule(settings: Record<string, string>) {
    const configService = {
      getOrThrow: (name: string) => {
        const value = settings[name];
        if (value === undefined) {
          throw new Error(`Missing setting ${name}.`);
        }
        return value;
      },
    };

    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        SupabaseModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(configService)
      .compile();
  }
});
