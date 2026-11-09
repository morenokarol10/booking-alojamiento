import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { OpenAPIObject } from '@nestjs/swagger';
import { mergeOpenApiDocuments } from './merge-openapi-documents';

describe('mergeOpenApiDocuments', () => {
  it('combines GDS operations and all operational API routes with their servers', () => {
    const integration = load(
      readFileSync(
        join(process.cwd(), 'contracts', 'alojamientos-openapi.yaml'),
        'utf8',
      ),
    ) as OpenAPIObject;
    const project = load(
      readFileSync(
        join(process.cwd(), 'contracts', 'booking-ec-project.openapi.yaml'),
        'utf8',
      ),
    ) as OpenAPIObject;

    expect(integration.info).toHaveProperty('x-inventory-rabbitmq', {
      provider: 'CloudAMQP',
      exchange: 'booking.events',
      exchangeType: 'topic',
      routingKey: 'stock.updated',
      connectionVariable: 'RABBITMQ_URL',
      delivery: 'persistent',
      publisherConfirms: true,
    });
    expect(integration.info.description).toContain(
      'Sincronización de stock — RabbitMQ',
    );

    const merged = mergeOpenApiDocuments(integration, project);

    expect(merged.paths['/alojamientos/search']?.post?.tags).toContain(
      'Alojamientos - Catálogo y Búsqueda v2',
    );
    expect(merged.paths['/alojamientos/availability']?.post).toBeDefined();
    expect(merged.paths['/alojamientos/health']?.get).toBeDefined();
    expect(merged.paths['/alojamientos/orders/create']?.post).toBeDefined();
    expect(merged.paths['/alojamientos/eventos']?.get).toBeDefined();
    expect(merged.paths['/api/v1/alojamientos']?.get).toBeDefined();
    expect(merged.paths['/api/v1/alojamientos']?.post).toBeDefined();
    expect(merged.paths['/api/v1/alojamientos/{id}']).toMatchObject({
      get: expect.any(Object),
      put: expect.any(Object),
      delete: expect.any(Object),
    });
    expect(merged.paths['/api/v1/reservas']).toMatchObject({
      get: expect.any(Object),
      post: expect.any(Object),
    });
    expect(merged.paths['/api/v1/admin/eventos']?.get).toBeDefined();
    expect(merged.paths['/api/v1/favoritos']?.get).toBeDefined();
    expect(merged.paths['/api/v1/favoritos']?.post).toBeDefined();
    expect(
      merged.paths['/api/v1/favoritos/{alojamientoId}']?.delete,
    ).toBeDefined();
    expect(merged.paths['/api/v1/auth/me/payment-method']?.put).toBeDefined();
    expect(merged.tags?.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'Alojamientos - Catálogo y Búsqueda v2',
        'Alojamientos - Disponibilidad y Cotización v2',
        'Alojamientos - Reservas y Órdenes Saga v2',
        'Alojamientos - Telemetría y Salud de Nodo v2',
        'Alojamientos',
        'Reservas',
        'Favoritos',
        'Administración',
      ]),
    );

    const accommodationServers = merged.paths['/api/v1/alojamientos']?.servers;
    expect(accommodationServers?.[0]?.url).toBe(
      'https://booking-alojamiento.onrender.com',
    );
    expect(merged.paths['/alojamientos/search']?.servers?.[0]?.url).toBe(
      'https://rda1-backend-integracion-sistemas.onrender.com/api/v2',
    );
    expect(merged.paths['/api/v1/alojamientos']?.get?.security).toEqual([]);
    expect(merged.paths['/api/v1/favoritos']?.get?.security).toEqual(
      project.security,
    );
  });
});
