import {
  appHasEffectApi,
  effectApiPrefix,
  effectApiStem,
  verticalEffectApps,
} from './descriptors';
import { packageName, toCamelCase, toPascalCase } from './naming';
import type { JsonValue, WorkspaceApp, WorkspaceEffectApi } from './types';

export function verticalEffectApiExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}EffectApi`;
}

export function verticalEffectGroupName(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return toCamelCase(effectApiStem(service));
}

export function verticalEffectApiName(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toPascalCase(effectApiStem(service))}EffectApi`;
}

export function verticalEffectSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}ItemSchema`;
}

export function verticalEffectMarkerSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}MarkerSchema`;
}

export function verticalEffectReadinessSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}ReadinessSchema`;
}

export function verticalEffectErrorStem(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return effectApiStem(service);
}

export function verticalEffectCreatePayloadSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}CreatePayloadSchema`;
}

export function verticalEffectNotFoundErrorExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toPascalCase(verticalEffectErrorStem(service))}NotFound`;
}

export function verticalEffectNotFoundSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(verticalEffectErrorStem(service))}NotFoundSchema`;
}

export function createEffectSharedApiImports(): string {
  return `import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  Schema,
} from '@modern-js/plugin-bff/effect-client';
`;
}

export function createEffectSharedApiContract(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): string {
  const schemaExport = verticalEffectSchemaExport(service);
  const markerSchemaExport = verticalEffectMarkerSchemaExport(service);
  const readinessSchemaExport = verticalEffectReadinessSchemaExport(service);
  const createPayloadSchemaExport =
    verticalEffectCreatePayloadSchemaExport(service);
  const notFoundErrorExport = verticalEffectNotFoundErrorExport(service);
  const notFoundSchemaExport = verticalEffectNotFoundSchemaExport(service);
  const apiExport = verticalEffectApiExport(service);
  const apiName = verticalEffectApiName(service);
  const groupName = verticalEffectGroupName(service);
  const stem = effectApiStem(service);
  const apiPrefix = effectApiPrefix(service);

  return `export const ${markerSchemaExport} = Schema.Struct({
  appId: Schema.String,
  build: Schema.String,
  deployProfile: Schema.String,
  packageName: Schema.String,
  surface: Schema.String,
  version: Schema.String,
});

export const ${schemaExport} = Schema.Struct({
  id: Schema.String,
  marker: ${markerSchemaExport},
  title: Schema.String,
});

export const ${readinessSchemaExport} = Schema.Struct({
  checks: Schema.Struct({
    effectBff: Schema.Literal('ready'),
    moduleFederation: Schema.Literal('ready'),
    ssr: Schema.Literal('ready'),
    translations: Schema.Literal('ready'),
  }),
  marker: ${markerSchemaExport},
  status: Schema.Literal('ready'),
  versionSkew: Schema.Literal('none'),
});

export const ${createPayloadSchemaExport} = Schema.Struct({
  title: Schema.String,
});

export class ${notFoundErrorExport} extends Schema.TaggedErrorClass<${notFoundErrorExport}>()(
  '${notFoundErrorExport}',
  {
    id: Schema.String,
  },
) {}

export const ${notFoundSchemaExport} = ${notFoundErrorExport}.pipe(
  HttpApiSchema.status(404),
);

export interface OperationContext {
  method: string;
  operationId: string;
  routePath: string;
  source: string;
  traceId?: string;
}

export const ${apiExport} = HttpApi.make('${apiName}').add(
  HttpApiGroup.make('${groupName}')
    .add(
      HttpApiEndpoint.get('list', '/effect/${stem}', {
        query: {
          limit: Schema.optional(Schema.FiniteFromString),
        },
        success: Schema.Struct({
          items: Schema.Array(${schemaExport}),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('readiness', '/effect/${stem}/readiness', {
        success: ${readinessSchemaExport},
      }),
    )
    .add(
      HttpApiEndpoint.get('get', '/effect/${stem}/:id', {
        error: ${notFoundSchemaExport},
        params: {
          id: Schema.String,
        },
        success: ${schemaExport},
      }),
    )
    .add(
      HttpApiEndpoint.post('create', '/effect/${stem}', {
        payload: ${createPayloadSchemaExport},
        success: Schema.Struct({
          item: ${schemaExport},
        }),
      }),
    ),
);

export const ${groupName}OperationContexts = {
  create: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:create',
    routePath: '/effect/${stem}',
    source: 'generated-client',
  },
  get: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:get',
    routePath: '/effect/${stem}/:id',
    source: 'generated-client',
  },
  list: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:list',
    routePath: '/effect/${stem}',
    source: 'generated-client',
  },
  readiness: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:readiness',
    routePath: '/effect/${stem}/readiness',
    source: 'generated-client',
  },
} satisfies Record<string, OperationContext>;

export const ${groupName}ApiContract = {
  apiPrefix: '${apiPrefix}',
  basePath: '${apiPrefix}/effect/${stem}',
  ownerId: '${service.id}',
  readinessPath: '${apiPrefix}/effect/${stem}/readiness',
} as const;
`;
}

export function createEffectSharedApi(service?: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): string {
  if (service) {
    return `${createEffectSharedApiImports()}
${createEffectSharedApiContract(service)}`;
  }

  return `export const sharedEffectApiPackage = {
  scope: 'external-effect-api-contracts',
} as const;
`;
}

export function createEffectServiceEntry(
  scope: string,
  service: { id: string; effectApi?: WorkspaceEffectApi },
  contractImportPath = packageName(scope, 'shared-effect-api'),
): string {
  const apiExport = verticalEffectApiExport(service);
  const groupName = verticalEffectGroupName(service);
  const notFoundErrorExport = verticalEffectNotFoundErrorExport(service);
  const stem = effectApiStem(service);

  return `import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-edge';
import { ultramodernApiMarker } from '../../src/ultramodern-build.ts';
import {
  ${apiExport},
  ${groupName}OperationContexts,
  ${notFoundErrorExport},
} from '${contractImportPath}';
import type { OperationContext } from '${contractImportPath}';

const ${groupName}Items = [
  {
    id: 'starter-${stem}',
    marker: ultramodernApiMarker,
    title: 'Wire a real ${stem} source here',
  },
];

const operationAttributes = (operationContext: OperationContext) => ({
    'modernjs.operation.id': operationContext.operationId,
    'modernjs.operation.method': operationContext.method,
    'modernjs.operation.route': operationContext.routePath,
    'modernjs.operation.source': operationContext.source,
    ...(typeof operationContext.traceId === 'string'
      ? { 'modernjs.trace.id': operationContext.traceId }
      : {}),
  });

const ${groupName}Layer = HttpApiBuilder.group(
  ${apiExport},
  '${groupName}',
  (handlers) =>
    handlers
      .handle('list', ({ query }) =>
        Effect.succeed({
          items:
            typeof query.limit === 'number'
              ? ${groupName}Items.slice(0, query.limit)
              : ${groupName}Items,
        }).pipe(
          Effect.withSpan('ultramodern.effect.${groupName}.list', {
            attributes: operationAttributes(${groupName}OperationContexts.list),
            kind: 'server',
          }),
        ),
      )
      .handle('readiness', () =>
        Effect.succeed({
          checks: {
            effectBff: 'ready' as const,
            moduleFederation: 'ready' as const,
            ssr: 'ready' as const,
            translations: 'ready' as const,
          },
          marker: ultramodernApiMarker,
          status: 'ready' as const,
          versionSkew: 'none' as const,
        }).pipe(
          Effect.withSpan('ultramodern.effect.${groupName}.readiness', {
            attributes: operationAttributes(${groupName}OperationContexts.readiness),
            kind: 'server',
          }),
        ),
      )
      .handle('get', ({ params }) => {
        const matchedItem = ${groupName}Items.find(
          candidate => candidate.id === params.id,
        );
        const result =
          matchedItem === undefined
            ? Effect.fail(new ${notFoundErrorExport}({ id: params.id }))
            : Effect.succeed(matchedItem);

        return result.pipe(
            Effect.withSpan('ultramodern.effect.${groupName}.get', {
              attributes: operationAttributes(${groupName}OperationContexts.get),
              kind: 'server',
            }),
          );
      })
      .handle('create', ({ payload }) =>
        Effect.succeed({
          item: {
            id: \`generated-${stem}-\${payload.title
              .toLowerCase()
              .replaceAll(/[^a-z0-9]+/gu, '-')
              .replaceAll(/^-|-$/gu, '')}\`,
            marker: ultramodernApiMarker,
            title: payload.title,
          },
        }).pipe(
          Effect.withSpan('ultramodern.effect.${groupName}.create', {
            attributes: operationAttributes(${groupName}OperationContexts.create),
            kind: 'server',
          }),
        ),
      ),
);

const layer = HttpApiBuilder.layer(${apiExport}).pipe(
  Layer.provide(${groupName}Layer),
);

export default defineEffectBff({
  api: ${apiExport},
  layer,
});
`;
}

export function createEffectClient(
  service: { id: string; effectApi?: WorkspaceEffectApi },
  contractImportPath: string,
): string {
  const apiExport = verticalEffectApiExport(service);
  const contractExport = verticalEffectGroupName(service);
  const stem = effectApiStem(service);
  const groupName = verticalEffectGroupName(service);
  const singular = verticalEffectErrorStem(service);
  const clientOptionsName = `${toPascalCase(stem)}ClientOptions`;
  const createClientName = `create${toPascalCase(stem)}Client`;
  const listName = `list${toPascalCase(stem)}`;
  const readinessName = `get${toPascalCase(stem)}Readiness`;
  const getName = `get${toPascalCase(singular)}`;
  const createName = `create${toPascalCase(singular)}`;

  return `import {
  Effect,
  makeEffectHttpApiClient,
  runEffectRequest,
} from '@modern-js/plugin-bff/effect-client';
import {
  ${contractExport}ApiContract,
  ${apiExport},
  ${groupName}OperationContexts,
} from '${contractImportPath}';
import type { OperationContext } from '${contractImportPath}';

export { Effect, runEffectRequest };

export interface ${clientOptionsName} {
  baseUrl?: string | URL;
  locale?: string;
  operationContext?: OperationContext;
  traceparent?: string;
}

export const ${createClientName} = (
  options: ${clientOptionsName} = {},
) =>
  makeEffectHttpApiClient(${apiExport}, {
    baseUrl: options.baseUrl ?? ${contractExport}ApiContract.apiPrefix,
  });

export const ${listName} = (
  options: ${clientOptionsName} & { limit?: number } = {},
) =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.list,
  }).pipe(
    Effect.flatMap(client =>
      client.${groupName}.list({ query: { limit: options.limit } }),
    ),
  );

export const ${readinessName} = (
  options: ${clientOptionsName} = {},
) =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.readiness,
  }).pipe(
    Effect.flatMap(client => client.${groupName}.readiness({})),
  );

export const ${getName} = (
  id: string,
  options: ${clientOptionsName} = {},
) =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.get,
  }).pipe(
    Effect.flatMap(client => client.${groupName}.get({ params: { id } })),
  );

export const ${createName} = (
  title: string,
  options: ${clientOptionsName} = {},
) =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.create,
  }).pipe(
    Effect.flatMap(client =>
      client.${groupName}.create({ payload: { title } }),
    ),
  );
`;
}

export function createShellEffectClient(
  scope: string,
  remotes: WorkspaceApp[] = [],
): string {
  const exports = verticalEffectApps(remotes)
    .map(remote => {
      const stem = effectApiStem(remote);
      const pascalStem = toPascalCase(stem);
      const pascalSingular = toPascalCase(verticalEffectErrorStem(remote));
      return `export {
  create${pascalSingular},
  create${pascalStem}Client,
  get${pascalSingular},
  get${pascalStem}Readiness,
  list${pascalStem},
  type ${pascalStem}ClientOptions,
} from '${packageName(scope, remote.packageSuffix)}/effect/client';`;
    })
    .join('\n\n');

  return exports
    ? `${exports}\n`
    : `export const ultramodernVerticalClients = [] as const;
`;
}

export function createEffectReadinessContract(app: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): JsonValue {
  const stem = effectApiStem(app);
  return {
    endpoint: `/effect/${stem}/readiness`,
    marker: {
      ui: 'ultramodernUiMarker',
      api: 'ultramodernApiMarker',
      skew: 'none',
    },
    checks: ['moduleFederation', 'ssr', 'translations', 'effectBff'],
  };
}

export function createEffectRequestContextContract(): JsonValue {
  return {
    propagatedHeaders: [
      'accept-language',
      'authorization',
      'traceparent',
      'x-correlation-id',
      'x-tenant-id',
      'x-ultramodern-env',
      'x-vertical-version-id',
    ],
    source: 'shell-to-vertical-effect-client',
  };
}

export function createEffectDomainOperations(app: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): JsonValue {
  const stem = effectApiStem(app);
  const group = verticalEffectGroupName(app);
  const basePath = `/effect/${stem}`;

  if (stem === 'actions') {
    return {
      actionQueue: {
        client: 'listActions',
        method: 'GET',
        path: basePath,
        resource: 'action-queue',
        owner: app.id,
      },
      actionMutation: {
        client: 'createActions',
        method: 'POST',
        path: basePath,
        resource: 'action',
        owner: app.id,
      },
      actionStatus: {
        client: 'getActions',
        method: 'GET',
        path: `${basePath}/:id`,
        resource: 'action-status',
        owner: app.id,
      },
    };
  }

  if (stem === 'records') {
    return {
      recordDetail: {
        client: 'getRecords',
        method: 'GET',
        path: `${basePath}/:id`,
        resource: 'record',
        owner: app.id,
      },
      recordDraft: {
        client: 'createRecords',
        method: 'POST',
        path: basePath,
        resource: 'record-draft',
        owner: app.id,
      },
      recordList: {
        client: 'listRecords',
        method: 'GET',
        path: basePath,
        resource: 'records',
        owner: app.id,
      },
    };
  }

  return {
    workspaceFeed: {
      client: `list${toPascalCase(stem)}`,
      method: 'GET',
      path: basePath,
      resource: 'workspace-items',
      owner: app.id,
    },
    workspaceDetail: {
      client: `get${toPascalCase(verticalEffectErrorStem(app))}`,
      method: 'GET',
      path: `${basePath}/:id`,
      resource: 'workspace-item',
      owner: app.id,
    },
    workspaceCreate: {
      client: `create${toPascalCase(verticalEffectErrorStem(app))}`,
      method: 'POST',
      path: basePath,
      resource: group,
      owner: app.id,
    },
  };
}

export function effectApiTopologyMetadata(
  app: WorkspaceApp,
): JsonValue | undefined {
  if (!appHasEffectApi(app)) {
    return undefined;
  }

  return {
    effect: {
      runtime: 'effect',
      bff: {
        prefix: app.effectApi.prefix,
        openapi: '/openapi.json',
      },
      contract: {
        export: './shared/effect/api',
        path: `${app.directory}/shared/effect/api.ts`,
      },
      client: {
        export: './effect/client',
        path: `${app.directory}/src/effect/${app.effectApi.stem}-client.ts`,
      },
      serverEntry: `${app.directory}/api/effect/index.ts`,
      basePath: `${app.effectApi.prefix}/effect/${app.effectApi.stem}`,
      consumedBy: app.effectApi.consumedBy,
      readiness: createEffectReadinessContract(app),
      requestContext: createEffectRequestContextContract(),
      domainOperations: createEffectDomainOperations(app),
    },
  };
}

export function createEffectOperationContract(target: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): JsonValue {
  const stem = effectApiStem(target);
  return {
    group: verticalEffectGroupName(target),
    notFound: verticalEffectNotFoundErrorExport(target),
    operations: {
      list: {
        method: 'GET',
        path: `/effect/${stem}`,
        source: 'generated-client',
      },
      readiness: {
        method: 'GET',
        path: `/effect/${stem}/readiness`,
        source: 'generated-client',
      },
      get: {
        method: 'GET',
        path: `/effect/${stem}/:id`,
        source: 'generated-client',
      },
      create: {
        method: 'POST',
        path: `/effect/${stem}`,
        source: 'generated-client',
      },
    },
  };
}
