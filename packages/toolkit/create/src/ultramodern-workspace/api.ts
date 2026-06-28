import {
  appHasApi,
  resolveApiPrefix,
  resolveApiStem,
  verticalApiApps,
} from './descriptors';
import { packageName, toCamelCase, toPascalCase } from './naming';
import type { JsonValue, WorkspaceApi, WorkspaceApp } from './types';

export function verticalApiExport(service: { id: string; api?: WorkspaceApi }) {
  return `${toCamelCase(resolveApiStem(service))}Api`;
}

export function verticalApiGroupName(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return toCamelCase(resolveApiStem(service));
}

export function verticalApiName(service: { id: string; api?: WorkspaceApi }) {
  return `${toPascalCase(resolveApiStem(service))}Api`;
}

export function verticalApiSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(resolveApiStem(service))}ItemSchema`;
}

export function verticalApiMarkerSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(resolveApiStem(service))}MarkerSchema`;
}

export function verticalApiReadinessSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(resolveApiStem(service))}ReadinessSchema`;
}

export function verticalApiErrorStem(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return resolveApiStem(service);
}

export function verticalApiCreatePayloadSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(resolveApiStem(service))}CreatePayloadSchema`;
}

export function verticalApiNotFoundErrorExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toPascalCase(verticalApiErrorStem(service))}NotFound`;
}

export function verticalApiNotFoundSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(verticalApiErrorStem(service))}NotFoundSchema`;
}

function serviceHasCheckoutCartState(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return resolveApiStem(service) === 'checkout';
}

function createCheckoutCartSharedSchemas(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `
export interface CheckoutCartLine {
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface CheckoutCart {
  readonly lines: readonly CheckoutCartLine[];
  readonly subtotalCents: number;
  readonly totalQuantity: number;
}

export interface CheckoutAddCartItemPayload {
  readonly sku: string;
  readonly name?: string;
  readonly quantity: number;
  readonly unitPriceCents?: number;
}

export interface CheckoutRemoveCartItemPayload {
  readonly sku: string;
}

export const checkoutCartLineSchema: Schema.Codec<CheckoutCartLine> = Schema.Struct({
  sku: Schema.String,
  name: Schema.String,
  quantity: Schema.Finite,
  unitPriceCents: Schema.Finite,
});

export const checkoutCartSchema: Schema.Codec<CheckoutCart> = Schema.Struct({
  lines: Schema.Array(checkoutCartLineSchema),
  subtotalCents: Schema.Finite,
  totalQuantity: Schema.Finite,
});

export const checkoutAddCartItemPayloadSchema: Schema.Codec<CheckoutAddCartItemPayload> = Schema.Struct({
  sku: Schema.String,
  name: Schema.optional(Schema.String),
  quantity: Schema.Finite,
  unitPriceCents: Schema.optional(Schema.Finite),
});

export const checkoutRemoveCartItemPayloadSchema: Schema.Codec<CheckoutRemoveCartItemPayload> = Schema.Struct({
  sku: Schema.String,
});
`;
}

function createCheckoutCartEndpointDefinitions(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `
    .add(
      HttpApiEndpoint.get('getCart', '/checkout/cart', {
        success: checkoutCartSchema,
      }),
    )
    .add(
      HttpApiEndpoint.post('addCartItem', '/checkout/cart/items', {
        payload: checkoutAddCartItemPayloadSchema,
        success: checkoutCartSchema,
      }),
    )
    .add(
      HttpApiEndpoint.post('removeCartItem', '/checkout/cart/remove', {
        payload: checkoutRemoveCartItemPayloadSchema,
        success: checkoutCartSchema,
      }),
    )
    .add(
      HttpApiEndpoint.post('clearCart', '/checkout/cart/clear', {
        success: checkoutCartSchema,
      }),
    )`;
}

function createCheckoutCartOperationContexts(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  const apiName = verticalApiName(service);
  const groupName = verticalApiGroupName(service);

  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `
  addCartItem: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:addCartItem',
    routePath: '/checkout/cart/items',
    source: 'generated-client',
  },
  clearCart: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:clearCart',
    routePath: '/checkout/cart/clear',
    source: 'generated-client',
  },
  getCart: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:getCart',
    routePath: '/checkout/cart',
    source: 'generated-client',
  },
  removeCartItem: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:removeCartItem',
    routePath: '/checkout/cart/remove',
    source: 'generated-client',
  },`;
}

function createCheckoutCartApiContractFields(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `  checkoutCartPath: '${resolveApiPrefix(service)}/checkout/cart',
`;
}

function createCheckoutCartServerState(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `
type CheckoutCartLine = {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
};

const checkoutCartLines = new Map<string, CheckoutCartLine>();

const createCheckoutCartSnapshot = () => {
  const lines = [...checkoutCartLines.values()].sort((left, right) =>
    left.sku.localeCompare(right.sku),
  );
  return {
    lines,
    subtotalCents: lines.reduce(
      (total, line) => total + line.quantity * line.unitPriceCents,
      0,
    ),
    totalQuantity: lines.reduce((total, line) => total + line.quantity, 0),
  };
};
`;
}

function createCheckoutCartServerHandlers(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  const groupName = verticalApiGroupName(service);

  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `
      .handle('getCart', () =>
        Effect.sync(() => createCheckoutCartSnapshot()).pipe(
          Effect.withSpan('ultramodern.api.${groupName}.checkout.getCart', {
            attributes: operationAttributes(${groupName}OperationContexts.getCart),
            kind: 'server',
          }),
        ),
      )
      .handle('addCartItem', ({ payload }) =>
        Effect.sync(() => {
          const existingLine = checkoutCartLines.get(payload.sku);
          checkoutCartLines.set(payload.sku, {
            sku: payload.sku,
            name: payload.name ?? existingLine?.name ?? payload.sku,
            quantity: (existingLine?.quantity ?? 0) + payload.quantity,
            unitPriceCents:
              payload.unitPriceCents ?? existingLine?.unitPriceCents ?? 0,
          });
          return createCheckoutCartSnapshot();
        }).pipe(
          Effect.withSpan('ultramodern.api.${groupName}.checkout.addCartItem', {
            attributes: operationAttributes(${groupName}OperationContexts.addCartItem),
            kind: 'server',
          }),
        ),
      )
      .handle('removeCartItem', ({ payload }) =>
        Effect.sync(() => {
          checkoutCartLines.delete(payload.sku);
          return createCheckoutCartSnapshot();
        }).pipe(
          Effect.withSpan('ultramodern.api.${groupName}.checkout.removeCartItem', {
            attributes: operationAttributes(${groupName}OperationContexts.removeCartItem),
            kind: 'server',
          }),
        ),
      )
      .handle('clearCart', () =>
        Effect.sync(() => {
          checkoutCartLines.clear();
          return createCheckoutCartSnapshot();
        }).pipe(
          Effect.withSpan('ultramodern.api.${groupName}.checkout.clearCart', {
            attributes: operationAttributes(${groupName}OperationContexts.clearCart),
            kind: 'server',
          }),
        ),
      )`;
}

function createCheckoutCartClientExports(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  const stem = resolveApiStem(service);
  const groupName = verticalApiGroupName(service);
  const pascalStem = toPascalCase(stem);
  const clientOptionsName = `${pascalStem}ClientOptions`;
  const createClientName = `create${pascalStem}Client`;
  const clientEffectTypeName = `${pascalStem}ClientEffect`;

  return `
export interface CheckoutCartLine {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CheckoutCart {
  lines: readonly CheckoutCartLine[];
  subtotalCents: number;
  totalQuantity: number;
}

export interface CheckoutAddCartItemInput {
  sku: string;
  name?: string;
  quantity: number;
  unitPriceCents?: number;
}

export const getCheckoutCart = (
  options: ${clientOptionsName} = {},
): ${clientEffectTypeName}<CheckoutCart> =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.getCart,
  }).pipe(
    Effect.flatMap(client => client.${groupName}.getCart({})),
  );

export const addCheckoutCartItem = (
  payload: CheckoutAddCartItemInput,
  options: ${clientOptionsName} = {},
): ${clientEffectTypeName}<CheckoutCart> =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.addCartItem,
  }).pipe(
    Effect.flatMap(client =>
      client.${groupName}.addCartItem({ payload }),
    ),
  );

export const removeCheckoutCartItem = (
  sku: string,
  options: ${clientOptionsName} = {},
): ${clientEffectTypeName}<CheckoutCart> =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.removeCartItem,
  }).pipe(
    Effect.flatMap(client =>
      client.${groupName}.removeCartItem({ payload: { sku } }),
    ),
  );

export const clearCheckoutCart = (
  options: ${clientOptionsName} = {},
): ${clientEffectTypeName}<CheckoutCart> =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.clearCart,
  }).pipe(
    Effect.flatMap(client => client.${groupName}.clearCart({})),
  );
`;
}

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
  const checkoutCartOperationContexts =
    createCheckoutCartOperationContexts(service).trimStart();
  const checkoutCartOperationContextEntries =
    checkoutCartOperationContexts === ''
      ? ''
      : `${checkoutCartOperationContexts}\n`;

  return `export interface ${markerType} {
  readonly appId: string;
  readonly build: string;
  readonly deployProfile: string;
  readonly packageName: string;
  readonly surface: string;
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
  deployProfile: Schema.String,
  packageName: Schema.String,
  surface: Schema.String,
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
${checkoutCartOperationContextEntries}  create: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:create',
    routePath: '/${stem}',
    source: 'generated-client',
  },
  get: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:get',
    routePath: '/${stem}/:id',
    source: 'generated-client',
  },
  list: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:list',
    routePath: '/${stem}',
    source: 'generated-client',
  },
  readiness: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:readiness',
    routePath: '/${stem}/readiness',
    source: 'generated-client',
  },
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

export function createApiServiceEntry(
  service: { id: string; api?: WorkspaceApi },
  contractImportPath: string,
): string {
  const apiExport = verticalApiExport(service);
  const groupName = verticalApiGroupName(service);
  const notFoundErrorExport = verticalApiNotFoundErrorExport(service);
  const stem = resolveApiStem(service);

  return `import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-edge';
import type {
  EffectBffDefinition,
  EffectBffRuntime,
  EffectRuntimeLayer,
} from '@modern-js/plugin-bff/effect-edge';
import { ultramodernApiMarker } from '../shared/ultramodern-build.ts';
import {
  ${apiExport},
  ${groupName}OperationContexts,
} from '${contractImportPath}';
import type {
  ${notFoundErrorExport},
  OperationContext,
} from '${contractImportPath}';

const ${groupName}Items = [
  {
    id: 'starter-${stem}',
    marker: ultramodernApiMarker,
    title: 'Wire a real ${stem} source here',
  },
];
${createCheckoutCartServerState(service)}

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
          Effect.withSpan('ultramodern.api.${groupName}.list', {
            attributes: operationAttributes(${groupName}OperationContexts.list),
            kind: 'server',
          }),
        ),
      )
      .handle('readiness', () =>
        Effect.succeed({
          checks: {
            api: 'ready' as const,
            moduleFederation: 'ready' as const,
            ssr: 'ready' as const,
            translations: 'ready' as const,
          },
          marker: ultramodernApiMarker,
          status: 'ready' as const,
          versionSkew: 'none' as const,
        }).pipe(
          Effect.withSpan('ultramodern.api.${groupName}.readiness', {
            attributes: operationAttributes(${groupName}OperationContexts.readiness),
            kind: 'server',
          }),
        ),
      )
      .handle('get', ({ params }) => {
        const matchedItem = ${groupName}Items.find(
          candidate => candidate.id === params.id,
        );
        const notFound: ${notFoundErrorExport} = {
          _tag: '${notFoundErrorExport}',
          id: params.id,
        };
        const result =
          matchedItem === undefined
            ? Effect.fail(notFound)
            : Effect.succeed(matchedItem);

        return result.pipe(
            Effect.withSpan('ultramodern.api.${groupName}.get', {
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
          Effect.withSpan('ultramodern.api.${groupName}.create', {
            attributes: operationAttributes(${groupName}OperationContexts.create),
            kind: 'server',
          }),
        ),
      )${createCheckoutCartServerHandlers(service)},
);

const layer = HttpApiBuilder.layer(${apiExport}).pipe(
  Layer.provide(${groupName}Layer),
) satisfies EffectRuntimeLayer;

const apiRuntime: EffectBffDefinition<typeof ${apiExport}, EffectRuntimeLayer> &
  EffectBffRuntime<typeof ${apiExport}, EffectRuntimeLayer> = defineEffectBff({
  api: ${apiExport},
  layer,
});

export default apiRuntime;
`;
}

export function createApiClient(
  service: { id: string; api?: WorkspaceApi },
  contractImportPath: string,
): string {
  const apiExport = verticalApiExport(service);
  const contractExport = verticalApiGroupName(service);
  const stem = resolveApiStem(service);
  const groupName = verticalApiGroupName(service);
  const singular = verticalApiErrorStem(service);
  const clientOptionsName = `${toPascalCase(stem)}ClientOptions`;
  const createClientName = `create${toPascalCase(stem)}Client`;
  const clientTypeName = `${toPascalCase(stem)}Client`;
  const clientEffectTypeName = `${toPascalCase(stem)}ClientEffect`;
  const listName = `list${toPascalCase(stem)}`;
  const readinessName = `get${toPascalCase(stem)}Readiness`;
  const getName = `get${toPascalCase(singular)}`;
  const createName = `create${toPascalCase(singular)}`;
  const notFoundErrorExport = verticalApiNotFoundErrorExport(service);
  const pascalStem = toPascalCase(stem);
  const itemType = `${pascalStem}Item`;
  const readinessType = `${pascalStem}Readiness`;
  const createResponseType = `${pascalStem}CreateResponse`;
  const listResponseType = `${pascalStem}ListResponse`;
  const checkoutCartClientExports = createCheckoutCartClientExports(service);

  return `import {
  Effect,
  makeEffectHttpApiClient,
  runEffectRequest,
} from '@modern-js/plugin-bff/effect-client';
import type {
  HttpClientError,
  HttpApi,
  HttpApiClient,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';
import {
  ${contractExport}ApiContract,
  ${apiExport},
  ${groupName}OperationContexts,
} from '${contractImportPath}';
import type {
  ${createResponseType},
  ${itemType},
  ${listResponseType},
  ${notFoundErrorExport},
  OperationContext,
  ${readinessType},
} from '${contractImportPath}';

export { Effect, runEffectRequest };

type ${pascalStem}ApiGroups = typeof ${apiExport} extends HttpApi.HttpApi<
  infer _ApiId,
  infer Groups
>
  ? Groups
  : never;

export type ${clientTypeName} = HttpApiClient.Client<
  Extract<${pascalStem}ApiGroups, HttpApiGroup.Any>,
  never,
  never
>;

export type ${pascalStem}ClientError =
  | ${notFoundErrorExport}
  | HttpClientError.HttpClientError
  | Schema.SchemaError;

export type ${clientEffectTypeName}<Success> = Effect.Effect<
  Success,
  ${pascalStem}ClientError,
  never
>;

export interface ${clientOptionsName} {
  baseUrl?: string | URL;
  locale?: string;
  operationContext?: OperationContext;
  traceparent?: string;
}

export const ${createClientName} = (
  options: ${clientOptionsName} = {},
): ${clientEffectTypeName}<${clientTypeName}> =>
  makeEffectHttpApiClient(${apiExport}, {
    baseUrl: options.baseUrl ?? ${contractExport}ApiContract.apiPrefix,
    requestContext: {
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.operationContext === undefined
        ? {}
        : { operationContext: options.operationContext }),
      ...(options.traceparent === undefined
        ? {}
        : { traceparent: options.traceparent }),
    },
  });

export const ${listName} = (
  options: ${clientOptionsName} & { limit?: number } = {},
): ${clientEffectTypeName}<${listResponseType}> =>
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
): ${clientEffectTypeName}<${readinessType}> =>
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
): ${clientEffectTypeName}<${itemType}> =>
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
): ${clientEffectTypeName}<${createResponseType}> =>
  ${createClientName}({
    ...options,
    operationContext:
      options.operationContext ?? ${groupName}OperationContexts.create,
  }).pipe(
    Effect.flatMap(client =>
      client.${groupName}.create({ payload: { title } }),
    ),
  );${checkoutCartClientExports}
`;
}

export function createShellApiClient(
  scope: string,
  remotes: WorkspaceApp[] = [],
): string {
  const exports = verticalApiApps(remotes)
    .map(remote => {
      const stem = resolveApiStem(remote);
      const pascalStem = toPascalCase(stem);
      const pascalSingular = toPascalCase(verticalApiErrorStem(remote));
      const checkoutCartExports = serviceHasCheckoutCartState(remote)
        ? `  addCheckoutCartItem,
  clearCheckoutCart,
  getCheckoutCart,
  removeCheckoutCartItem,
  type CheckoutAddCartItemInput,
  type CheckoutCart,
  type CheckoutCartLine,
`
        : '';
      return `export {
${checkoutCartExports}  create${pascalSingular},
  create${pascalStem}Client,
  get${pascalSingular},
  get${pascalStem}Readiness,
  list${pascalStem},
  type ${pascalStem}ClientOptions,
} from '${packageName(scope, remote.packageSuffix)}/api/client';`;
    })
    .join('\n\n');

  return exports
    ? `${exports}\n`
    : `export const ultramodernVerticalClients = [] as const;
`;
}

export function createApiReadinessContract(app: {
  id: string;
  api?: WorkspaceApi;
}): JsonValue {
  const stem = resolveApiStem(app);
  return {
    endpoint: `/${stem}/readiness`,
    marker: {
      ui: 'ultramodernUiMarker',
      api: 'ultramodernApiMarker',
      skew: 'none',
    },
    checks: ['moduleFederation', 'ssr', 'translations', 'api'],
  };
}

export function createApiRequestContextContract(): JsonValue {
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
    source: 'shell-to-vertical-api-client',
  };
}

export function createApiDomainOperations(app: {
  id: string;
  api?: WorkspaceApi;
}): JsonValue {
  const stem = resolveApiStem(app);
  const group = verticalApiGroupName(app);
  const basePath = `/${stem}`;
  const checkoutCartOperations = serviceHasCheckoutCartState(app)
    ? {
        checkoutCartAddItem: {
          client: 'addCheckoutCartItem',
          method: 'POST',
          path: '/checkout/cart/items',
          resource: 'checkout-cart',
          owner: app.id,
        },
        checkoutCartClear: {
          client: 'clearCheckoutCart',
          method: 'POST',
          path: '/checkout/cart/clear',
          resource: 'checkout-cart',
          owner: app.id,
        },
        checkoutCartRead: {
          client: 'getCheckoutCart',
          method: 'GET',
          path: '/checkout/cart',
          resource: 'checkout-cart',
          owner: app.id,
        },
        checkoutCartRemoveItem: {
          client: 'removeCheckoutCartItem',
          method: 'POST',
          path: '/checkout/cart/remove',
          resource: 'checkout-cart',
          owner: app.id,
        },
      }
    : {};

  return {
    ...checkoutCartOperations,
    workspaceFeed: {
      client: `list${toPascalCase(stem)}`,
      method: 'GET',
      path: basePath,
      resource: 'workspace-items',
      owner: app.id,
    },
    workspaceDetail: {
      client: `get${toPascalCase(verticalApiErrorStem(app))}`,
      method: 'GET',
      path: `${basePath}/:id`,
      resource: 'workspace-item',
      owner: app.id,
    },
    workspaceCreate: {
      client: `create${toPascalCase(verticalApiErrorStem(app))}`,
      method: 'POST',
      path: basePath,
      resource: group,
      owner: app.id,
    },
  };
}

export function apiTopologyMetadata(app: WorkspaceApp): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  return {
    runtime: 'effect',
    bff: {
      prefix: app.api.prefix,
      openapi: '/openapi.json',
      strictEffectApproach: true,
    },
    contract: {
      export: './api',
      path: `${app.directory}/shared/api.ts`,
    },
    client: {
      export: './api/client',
      path: `${app.directory}/src/api/${app.api.stem}-client.ts`,
    },
    serverEntry: `${app.directory}/api/index.ts`,
    basePath: `${app.api.prefix}/${app.api.stem}`,
    consumedBy: app.api.consumedBy,
    readiness: createApiReadinessContract(app),
    requestContext: createApiRequestContextContract(),
    domainOperations: createApiDomainOperations(app),
  };
}

export function createApiOperationContract(target: {
  id: string;
  api?: WorkspaceApi;
}): JsonValue {
  const stem = resolveApiStem(target);
  const checkoutCartOperations = serviceHasCheckoutCartState(target)
    ? {
        addCartItem: {
          method: 'POST',
          path: '/checkout/cart/items',
          source: 'generated-client',
        },
        clearCart: {
          method: 'POST',
          path: '/checkout/cart/clear',
          source: 'generated-client',
        },
        getCart: {
          method: 'GET',
          path: '/checkout/cart',
          source: 'generated-client',
        },
        removeCartItem: {
          method: 'POST',
          path: '/checkout/cart/remove',
          source: 'generated-client',
        },
      }
    : {};
  return {
    group: verticalApiGroupName(target),
    notFound: verticalApiNotFoundErrorExport(target),
    operations: {
      ...checkoutCartOperations,
      list: {
        method: 'GET',
        path: `/${stem}`,
        source: 'generated-client',
      },
      readiness: {
        method: 'GET',
        path: `/${stem}/readiness`,
        source: 'generated-client',
      },
      get: {
        method: 'GET',
        path: `/${stem}/:id`,
        source: 'generated-client',
      },
      create: {
        method: 'POST',
        path: `/${stem}`,
        source: 'generated-client',
      },
    },
  };
}
