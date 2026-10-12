import { NestFactory } from '@nestjs/core';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { AppModule } from './app.module';

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

  const parsedIntegrationContract: unknown = load(
    readFileSync(
      join(process.cwd(), 'contracts', 'alojamientos-openapi.yaml'),
      'utf8',
    ),
  );
  if (!isOpenApiDocument(parsedIntegrationContract)) {
    throw new Error(
      'El contrato GDS debe contener metadatos OpenAPI válidos y al menos una operación documentada.',
    );
  }
  const integrationContract = parsedIntegrationContract;

  const parsedProjectContract: unknown = load(
    readFileSync(
      join(process.cwd(), 'contracts', 'booking-ec-project.openapi.yaml'),
      'utf8',
    ),
  );
  if (!isOpenApiDocument(parsedProjectContract)) {
    throw new Error(
      'El contrato OpenAPI del proyecto debe contener metadatos válidos y al menos una operación documentada.',
    );
  }
  const projectContract = parsedProjectContract;

  const swaggerConfig = new DocumentBuilder()
    .setTitle(projectContract.info.title)
    .setDescription(projectContract.info.description ?? '')
    .setVersion(projectContract.info.version)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'supabase-jwt',
    )
    .build();
  if (projectContract.tags) {
    for (const tag of projectContract.tags) {
      swaggerConfig.tags = [
        ...(swaggerConfig.tags ?? []),
        { name: tag.name, description: tag.description },
      ];
    }
  }
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, integrationContract, {
    swaggerOptions: {
      tryItOutEnabled: true,
      supportedSubmitMethods: [
        'get',
        'post',
        'put',
        'delete',
        'patch',
        'options',
        'head',
        'trace',
      ],
    },
  });
  SwaggerModule.setup('api/project-docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}

function isOpenApiDocument(value: unknown): value is OpenAPIObject {
  if (!isRecord(value) || !isRecord(value.info) || !isRecord(value.paths)) {
    return false;
  }
  if (
    typeof value.openapi !== 'string' ||
    !/^3\.[01]\.\d+$/.test(value.openapi) ||
    typeof value.info.title !== 'string' ||
    typeof value.info.version !== 'string'
  ) {
    return false;
  }
  if (
    value.tags !== undefined &&
    (!Array.isArray(value.tags) ||
      !value.tags.every(
        (tag) =>
          isRecord(tag) &&
          typeof tag.name === 'string' &&
          (tag.description === undefined ||
            typeof tag.description === 'string'),
      ))
  ) {
    return false;
  }

  const httpMethods = new Set([
    'get',
    'put',
    'post',
    'delete',
    'options',
    'head',
    'patch',
    'trace',
  ]);
  let operationCount = 0;
  for (const pathItem of Object.values(value.paths)) {
    if (!isRecord(pathItem)) return false;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method)) continue;
      if (!isRecord(operation) || !isRecord(operation.responses)) return false;
      operationCount += 1;
    }
  }
  return operationCount > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void bootstrap();
