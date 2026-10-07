import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { AppModule } from './app.module';

interface OfficialOpenApiDocument {
  info: {
    title: string;
    description: string;
    version: string;
  };
  tags?: Array<{ name: string; description?: string }>;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use('/marketplace', express.static(join(process.cwd(), 'public')));
  app.use('/login', express.static(join(process.cwd(), 'public', 'login')));
  app.use('/admin', express.static(join(process.cwd(), 'public', 'admin')));
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const parsedContract: unknown = load(
    readFileSync(
      join(process.cwd(), 'contracts', 'alojamientos-openapi.yaml'),
      'utf8',
    ),
  );
  if (!isOfficialOpenApiDocument(parsedContract)) {
    throw new Error(
      'El contrato OpenAPI debe definir metadatos válidos y tags con nombre.',
    );
  }
  const officialContract = parsedContract;

  const swaggerConfig = new DocumentBuilder()
    .setTitle(officialContract.info.title)
    .setDescription(officialContract.info.description)
    .setVersion(officialContract.info.version)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'supabase-jwt',
    )
    .addTag('Alojamientos', 'Gestión de hoteles y habitaciones')
    .addTag('Reservas', 'Flujo de reservas')
    .addTag('Administración', 'Operaciones administrativas')
    .build();
  if (officialContract.tags) {
    for (const tag of officialContract.tags) {
      swaggerConfig.tags = [
        ...(swaggerConfig.tags ?? []),
        { name: tag.name, description: tag.description },
      ];
    }
  }
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}

function isOfficialOpenApiDocument(
  value: unknown,
): value is OfficialOpenApiDocument {
  if (!isRecord(value) || !isRecord(value.info)) return false;
  if (
    typeof value.info.title !== 'string' ||
    typeof value.info.description !== 'string' ||
    typeof value.info.version !== 'string'
  ) {
    return false;
  }
  if (value.tags === undefined) return true;
  return (
    Array.isArray(value.tags) &&
    value.tags.every(
      (tag) =>
        isRecord(tag) &&
        typeof tag.name === 'string' &&
        (tag.description === undefined || typeof tag.description === 'string'),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void bootstrap();
