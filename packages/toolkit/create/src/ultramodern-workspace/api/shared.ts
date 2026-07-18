import { resolveApiPrefix, resolveApiStem } from '../descriptors';
import { renderTemplate } from '../fs-io';
import { packageName, toPascalCase } from '../naming';
import type { WorkspaceApi } from '../types';
import {
  createCheckoutCartApiContractFields,
  createCheckoutCartEndpointDefinitions,
  createCheckoutCartOperationContexts,
  createCheckoutCartSharedSchemas,
} from './checkout-cart';
import {
  verticalApiCreatePayloadSchemaExport,
  verticalApiExport,
  verticalApiGroupName,
  verticalApiMarkerSchemaExport,
  verticalApiName,
  verticalApiNotFoundErrorExport,
  verticalApiNotFoundSchemaExport,
  verticalApiReadinessSchemaExport,
  verticalApiSchemaExport,
} from './names';

export function createSharedApiImports(): string {
  return `import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  Schema,
} from '@modern-js/plugin-bff/effect-client';
`;
}

export function createSharedApiContract(service: {
  id: string;
  api?: WorkspaceApi;
}): string {
  const schemaExport = verticalApiSchemaExport(service);
  const markerSchemaExport = verticalApiMarkerSchemaExport(service);
  const readinessSchemaExport = verticalApiReadinessSchemaExport(service);
  const createPayloadSchemaExport =
    verticalApiCreatePayloadSchemaExport(service);
  const notFoundErrorExport = verticalApiNotFoundErrorExport(service);
  const notFoundSchemaExport = verticalApiNotFoundSchemaExport(service);
  const apiExport = verticalApiExport(service);
  const apiName = verticalApiName(service);
  const groupName = verticalApiGroupName(service);
  const stem = resolveApiStem(service);
  const pascalStem = toPascalCase(stem);
  const markerType = `${pascalStem}Marker`;
  const itemType = `${pascalStem}Item`;
  const readinessType = `${pascalStem}Readiness`;
  const createPayloadType = `${pascalStem}CreatePayload`;
  const createResponseType = `${pascalStem}CreateResponse`;
  const listResponseType = `${pascalStem}ListResponse`;
  const apiPrefix = resolveApiPrefix(service);
  const checkoutCartSharedSchemas = createCheckoutCartSharedSchemas(service);
  const checkoutCartSharedSchemaSection =
    checkoutCartSharedSchemas === '' ? '' : `${checkoutCartSharedSchemas}\n`;
  const createOperationContext = `  create: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:create',
    routePath: '/${stem}',
    source: 'generated-client',
  },`;
  const getOperationContext = `  get: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:get',
    routePath: '/${stem}/:id',
    source: 'generated-client',
  },`;
  const listOperationContext = `  list: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:list',
    routePath: '/${stem}',
    source: 'generated-client',
  },`;
  const readinessOperationContext = `  readiness: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:readiness',
    routePath: '/${stem}/readiness',
    source: 'generated-client',
  },`;
  const checkoutCartOperationContextTemplate =
    createCheckoutCartOperationContexts(service);
  const operationContextEntries =
    checkoutCartOperationContextTemplate === ''
      ? [
          createOperationContext,
          getOperationContext,
          listOperationContext,
          readinessOperationContext,
        ].join('\n')
      : renderTemplate(checkoutCartOperationContextTemplate, {
          createOperationContext,
          getOperationContext,
          listOperationContext,
          readinessOperationContext,
        }).trim();

  return `export interface ${markerType} {
  readonly appId: string;
  readonly build: string;
  readonly buildMarker: string;
  readonly deployProfile: string;
  readonly packageName: string;
  readonly sourceRevision: string;
  readonly surface: string;
  readonly unitId: string;
  readonly version: string;
}

export interface ${itemType} {
  readonly id: string;
  readonly marker: ${markerType};
  readonly title: string;
}

export interface ${readinessType} {
  readonly checks: {
    readonly api: 'ready';
    readonly moduleFederation: 'ready';
    readonly ssr: 'ready';
    readonly translations: 'ready';
  };
  readonly marker: ${markerType};
  readonly status: 'ready';
  readonly versionSkew: 'none';
}

export interface ${createPayloadType} {
  readonly title: string;
}

export interface ${listResponseType} {
  readonly items: readonly ${itemType}[];
}

export interface ${createResponseType} {
  readonly item: ${itemType};
}

export interface ${notFoundErrorExport} {
  readonly _tag: '${notFoundErrorExport}';
  readonly id: string;
}

export const ${markerSchemaExport}: Schema.Codec<${markerType}> = Schema.Struct({
  appId: Schema.String,
  build: Schema.String,
  buildMarker: Schema.String,
  deployProfile: Schema.String,
  packageName: Schema.String,
  sourceRevision: Schema.String,
  surface: Schema.String,
  unitId: Schema.String,
  version: Schema.String,
});

export const ${schemaExport}: Schema.Codec<${itemType}> = Schema.Struct({
  id: Schema.String,
  marker: ${markerSchemaExport},
  title: Schema.String,
});

export const ${readinessSchemaExport}: Schema.Codec<${readinessType}> = Schema.Struct({
  checks: Schema.Struct({
    api: Schema.Literal('ready'),
    moduleFederation: Schema.Literal('ready'),
    ssr: Schema.Literal('ready'),
    translations: Schema.Literal('ready'),
  }),
  marker: ${markerSchemaExport},
  status: Schema.Literal('ready'),
  versionSkew: Schema.Literal('none'),
});

export const ${createPayloadSchemaExport}: Schema.Codec<${createPayloadType}> = Schema.Struct({
  title: Schema.String,
});

${checkoutCartSharedSchemaSection}export const ${notFoundSchemaExport}: Schema.Codec<${notFoundErrorExport}> = Schema.TaggedStruct('${notFoundErrorExport}', {
  id: Schema.String,
}).pipe(
  HttpApiSchema.status(404),
);

export interface OperationContext {
  method: string;
  operationId: string;
  routePath: string;
  source:
    | 'client'
    | 'server'
    | 'generated-client'
    | 'effect-adapter'
    | 'data-platform'
    | 'unknown';
  traceId?: string;
}

export const ${apiExport} = HttpApi.make('${apiName}').add(
  HttpApiGroup.make('${groupName}')
    .add(
      HttpApiEndpoint.get('list', '/${stem}', {
        query: {
          limit: Schema.optional(Schema.FiniteFromString),
        },
        success: Schema.Struct({
          items: Schema.Array(${schemaExport}),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('readiness', '/${stem}/readiness', {
        success: ${readinessSchemaExport},
      }),
    )
    .add(
      HttpApiEndpoint.get('get', '/${stem}/:id', {
        error: ${notFoundSchemaExport},
        params: {
          id: Schema.String,
        },
        success: ${schemaExport},
      }),
    )
    .add(
      HttpApiEndpoint.post('create', '/${stem}', {
        payload: ${createPayloadSchemaExport},
        success: Schema.Struct({
          item: ${schemaExport},
        }),
      }),
    )${createCheckoutCartEndpointDefinitions(service)},
);

export const ${groupName}OperationContexts = {
${operationContextEntries}
} satisfies Record<string, OperationContext>;

export const ${groupName}ApiContract = {
  apiPrefix: '${apiPrefix}',
  basePath: '${apiPrefix}/${stem}',
${createCheckoutCartApiContractFields(service)}  ownerId: '${service.id}',
  readinessPath: '${apiPrefix}/${stem}/readiness',
} as const;
`;
}

export function createSharedApi(service: {
  id: string;
  api?: WorkspaceApi;
}): string {
  return `${createSharedApiImports()}
${createSharedApiContract(service)}`;
}
