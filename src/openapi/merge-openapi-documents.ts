import type {
  ComponentsObject,
  OpenAPIObject,
  PathItemObject,
  SecurityRequirementObject,
  ServerObject,
  TagObject,
} from '@nestjs/swagger';

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export function mergeOpenApiDocuments(
  integration: OpenAPIObject,
  project: OpenAPIObject,
): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = {};

  for (const [path, pathItem] of Object.entries(integration.paths)) {
    paths[path] = withOperationSecurity(
      pathItem,
      integration.security ?? [],
      integration.servers ?? [],
    );
  }

  const projectServers = (project.servers ?? []).map(withoutApiPrefix);
  for (const [path, pathItem] of Object.entries(project.paths)) {
    const fullPath = path.startsWith('/api/v1/')
      ? path
      : `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
    if (paths[fullPath]) {
      throw new Error(
        `No se puede combinar OpenAPI: la ruta local ${fullPath} ya existe.`,
      );
    }
    paths[fullPath] = withOperationSecurity(
      pathItem,
      project.security ?? [],
      projectServers,
    );
  }

  const components = mergeComponents(
    integration.components,
    project.components,
  );
  return {
    openapi: integration.openapi,
    info: {
      title: 'Booking EC - API GDS y Operativa',
      version: project.info.version,
      description:
        'Especificación combinada: conserva las operaciones GDS del contrato de integración y documenta también la API operativa de Booking EC. Los grupos usan servidores diferentes según el path.',
    },
    servers: [...(integration.servers ?? []), ...projectServers],
    paths,
    ...(components ? { components } : {}),
    tags: mergeTags(integration.tags ?? [], project.tags ?? []),
  };
}

function withoutApiPrefix(server: ServerObject): ServerObject {
  return {
    ...server,
    url: server.url.replace(/\/api\/v1\/?$/, ''),
  };
}

function withOperationSecurity(
  pathItem: PathItemObject,
  inheritedSecurity: SecurityRequirementObject[],
  servers: ServerObject[],
): PathItemObject {
  const result: PathItemObject = { ...pathItem, servers };
  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    if (operation) {
      result[method] = {
        ...operation,
        security: operation.security ?? inheritedSecurity,
      };
    }
  }
  return result;
}

function mergeComponents(
  integration?: ComponentsObject,
  project?: ComponentsObject,
): ComponentsObject | undefined {
  if (!integration && !project) return undefined;
  return {
    ...integration,
    ...project,
    schemas: { ...integration?.schemas, ...project?.schemas },
    responses: { ...integration?.responses, ...project?.responses },
    parameters: { ...integration?.parameters, ...project?.parameters },
    examples: { ...integration?.examples, ...project?.examples },
    requestBodies: { ...integration?.requestBodies, ...project?.requestBodies },
    headers: { ...integration?.headers, ...project?.headers },
    securitySchemes: {
      ...integration?.securitySchemes,
      ...project?.securitySchemes,
    },
    links: { ...integration?.links, ...project?.links },
    callbacks: { ...integration?.callbacks, ...project?.callbacks },
  };
}

function mergeTags(
  integration: TagObject[],
  project: TagObject[],
): TagObject[] {
  const tags = new Map<string, TagObject>();
  for (const tag of [...integration, ...project]) {
    tags.set(tag.name, { ...tags.get(tag.name), ...tag });
  }
  return [...tags.values()];
}
