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

    const merged = mergeOpenApiDocuments(integration, project);

    expect(merged.paths['/search']?.post?.tags).toContain(
      'Búsqueda y Catálogo',
    );
    expect(merged.paths['/availability']?.post).toBeDefined();
    expect(merged.paths['/bulk-availability']?.post).toBeDefined();
    expect(merged.paths['/details']?.post).toBeDefined();
    expect(merged.paths['/orders/create']?.post).toBeDefined();
    expect(merged.paths['/webhooks']?.post).toBeDefined();
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
    expect(
      merged.paths['/api/v1/auth/me/payment-method']?.put,
    ).toBeDefined();
    expect(merged.tags?.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'Búsqueda y Catálogo',
        'Disponibilidad y Precios',
        'Gestión de Órdenes (Reservas)',
        'Webhooks',
        'Autenticación',
        'Alojamientos',
        'Reservas',
        'Favoritos',
        'Administración',
      ]),
    );

    const accommodationServers =
      merged.paths['/api/v1/alojamientos']?.servers;
    expect(accommodationServers?.[0]?.url).toBe(
      'https://booking-alojamiento.onrender.com',
    );
    expect(merged.paths['/search']?.servers?.[0]?.url).toBe(
      'https://api.booking-hub.com/alojamientos/v1',
    );
    expect(merged.paths['/api/v1/alojamientos']?.get?.security).toEqual([]);
    expect(
      merged.paths['/api/v1/favoritos']?.get?.security,
    ).toEqual(project.security);
  });
});
