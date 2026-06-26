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

function serviceHasCheckoutCartState(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return effectApiStem(service) === 'checkout';
}

function createCheckoutCartSharedSchemas(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
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
  readonly lines: ReadonlyArray<CheckoutCartLine>;
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

export const checkoutCartLineSchema: Schema.Schema<CheckoutCartLine> = Schema.Struct({
  sku: Schema.String,
  name: Schema.String,
  quantity: Schema.Finite,
  unitPriceCents: Schema.Finite,
});

export const checkoutCartSchema: Schema.Schema<CheckoutCart> = Schema.Struct({
  lines: Schema.Array(checkoutCartLineSchema),
  subtotalCents: Schema.Finite,
  totalQuantity: Schema.Finite,
});

export const checkoutAddCartItemPayloadSchema: Schema.Schema<CheckoutAddCartItemPayload> = Schema.Struct({
  sku: Schema.String,
  name: Schema.optional(Schema.String),
  quantity: Schema.Finite,
  unitPriceCents: Schema.optional(Schema.Finite),
});

export const checkoutRemoveCartItemPayloadSchema: Schema.Schema<CheckoutRemoveCartItemPayload> = Schema.Struct({
  sku: Schema.String,
});
`;
}

function createCheckoutCartEndpointDefinitions(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `
    .add(
      HttpApiEndpoint.get('getCart', '/effect/checkout/cart', {
        success: checkoutCartSchema,
      }),
    )
    .add(
      HttpApiEndpoint.post('addCartItem', '/effect/checkout/cart/items', {
        payload: checkoutAddCartItemPayloadSchema,
        success: checkoutCartSchema,
      }),
    )
    .add(
      HttpApiEndpoint.post('removeCartItem', '/effect/checkout/cart/remove', {
        payload: checkoutRemoveCartItemPayloadSchema,
        success: checkoutCartSchema,
      }),
    )
    .add(
      HttpApiEndpoint.post('clearCart', '/effect/checkout/cart/clear', {
        success: checkoutCartSchema,
      }),
    )`;
}

function createCheckoutCartOperationContexts(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  const apiName = verticalEffectApiName(service);
  const groupName = verticalEffectGroupName(service);

  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `
  addCartItem: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:addCartItem',
    routePath: '/effect/checkout/cart/items',
    source: 'generated-client',
  },
  clearCart: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:clearCart',
    routePath: '/effect/checkout/cart/clear',
    source: 'generated-client',
  },
  getCart: {
    method: 'GET',
    operationId: '${apiName}:${groupName}:getCart',
    routePath: '/effect/checkout/cart',
    source: 'generated-client',
  },
  removeCartItem: {
    method: 'POST',
    operationId: '${apiName}:${groupName}:removeCartItem',
    routePath: '/effect/checkout/cart/remove',
    source: 'generated-client',
  },`;
}

function createCheckoutCartApiContractFields(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `  checkoutCartPath: '${effectApiPrefix(service)}/effect/checkout/cart',
`;
}

function createCheckoutCartServerState(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
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
  effectApi?: WorkspaceEffectApi;
}) {
  const groupName = verticalEffectGroupName(service);

  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return `
      .handle('getCart', () =>
        Effect.sync(() => createCheckoutCartSnapshot()).pipe(
          Effect.withSpan('ultramodern.effect.${groupName}.checkout.getCart', {
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
          Effect.withSpan('ultramodern.effect.${groupName}.checkout.addCartItem', {
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
          Effect.withSpan('ultramodern.effect.${groupName}.checkout.removeCartItem', {
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
          Effect.withSpan('ultramodern.effect.${groupName}.checkout.clearCart', {
            attributes: operationAttributes(${groupName}OperationContexts.clearCart),
            kind: 'server',
          }),
        ),
      )`;
}

function createCheckoutCartClientExports(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  const stem = effectApiStem(service);
  const groupName = verticalEffectGroupName(service);
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
  const pascalStem = toPascalCase(stem);
  const markerType = `${pascalStem}Marker`;
  const itemType = `${pascalStem}Item`;
  const readinessType = `${pascalStem}Readiness`;
  const createPayloadType = `${pascalStem}CreatePayload`;
  const createResponseType = `${pascalStem}CreateResponse`;
  const listResponseType = `${pascalStem}ListResponse`;
  const apiPrefix = effectApiPrefix(service);
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
    readonly effectBff: 'ready';
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
  readonly items: ReadonlyArray<${itemType}>;
}

export interface ${createResponseType} {
  readonly item: ${itemType};
}

export interface ${notFoundErrorExport} {
  readonly _tag: '${notFoundErrorExport}';
  readonly id: string;
}

export const ${markerSchemaExport}: Schema.Schema<${markerType}> = Schema.Struct({
  appId: Schema.String,
  build: Schema.String,
  deployProfile: Schema.String,
  packageName: Schema.String,
  surface: Schema.String,
  version: Schema.String,
});

export const ${schemaExport}: Schema.Schema<${itemType}> = Schema.Struct({
  id: Schema.String,
  marker: ${markerSchemaExport},
  title: Schema.String,
});

export const ${readinessSchemaExport}: Schema.Schema<${readinessType}> = Schema.Struct({
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

export const ${createPayloadSchemaExport}: Schema.Schema<${createPayloadType}> = Schema.Struct({
  title: Schema.String,
});

${checkoutCartSharedSchemaSection}export const ${notFoundSchemaExport}: Schema.Schema<${notFoundErrorExport}> = Schema.TaggedStruct('${notFoundErrorExport}', {
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
    )${createCheckoutCartEndpointDefinitions(service)},
);

export const ${groupName}OperationContexts = {
${checkoutCartOperationContextEntries}  create: {
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
${createCheckoutCartApiContractFields(service)}  ownerId: '${service.id}',
  readinessPath: '${apiPrefix}/effect/${stem}/readiness',
} as const;
`;
}

export function createEffectSharedApi(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): string {
  return `${createEffectSharedApiImports()}
${createEffectSharedApiContract(service)}`;
}

export function createEffectServiceEntry(
  service: { id: string; effectApi?: WorkspaceEffectApi },
  contractImportPath: string,
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
import type {
  EffectBffDefinition,
  EffectBffRuntime,
  EffectRuntimeLayer,
} from '@modern-js/plugin-bff/effect-edge';
import { ultramodernApiMarker } from '../../src/ultramodern-build.ts';
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
        const notFound: ${notFoundErrorExport} = {
          _tag: '${notFoundErrorExport}',
          id: params.id,
        };
        const result =
          matchedItem === undefined
            ? Effect.fail(notFound)
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
      )${createCheckoutCartServerHandlers(service)},
);

const layer = HttpApiBuilder.layer(${apiExport}).pipe(
  Layer.provide(${groupName}Layer),
) satisfies EffectRuntimeLayer;

const effectBff: EffectBffDefinition<typeof ${apiExport}, EffectRuntimeLayer> &
  EffectBffRuntime<typeof ${apiExport}, EffectRuntimeLayer> = defineEffectBff({
  api: ${apiExport},
  layer,
});

export default effectBff;
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
  const clientTypeName = `${toPascalCase(stem)}Client`;
  const clientEffectTypeName = `${toPascalCase(stem)}ClientEffect`;
  const listName = `list${toPascalCase(stem)}`;
  const readinessName = `get${toPascalCase(stem)}Readiness`;
  const getName = `get${toPascalCase(singular)}`;
  const createName = `create${toPascalCase(singular)}`;
  const notFoundErrorExport = verticalEffectNotFoundErrorExport(service);
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

type ${pascalStem}EffectGroups = typeof ${apiExport} extends HttpApi.HttpApi<
  infer _ApiId,
  infer Groups
>
  ? Groups
  : never;

export type ${clientTypeName} = HttpApiClient.Client<
  Extract<${pascalStem}EffectGroups, HttpApiGroup.Any>,
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

export function createShellEffectClient(
  scope: string,
  remotes: WorkspaceApp[] = [],
): string {
  const exports = verticalEffectApps(remotes)
    .map(remote => {
      const stem = effectApiStem(remote);
      const pascalStem = toPascalCase(stem);
      const pascalSingular = toPascalCase(verticalEffectErrorStem(remote));
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
  const checkoutCartOperations = serviceHasCheckoutCartState(app)
    ? {
        checkoutCartAddItem: {
          client: 'addCheckoutCartItem',
          method: 'POST',
          path: '/effect/checkout/cart/items',
          resource: 'checkout-cart',
          owner: app.id,
        },
        checkoutCartClear: {
          client: 'clearCheckoutCart',
          method: 'POST',
          path: '/effect/checkout/cart/clear',
          resource: 'checkout-cart',
          owner: app.id,
        },
        checkoutCartRead: {
          client: 'getCheckoutCart',
          method: 'GET',
          path: '/effect/checkout/cart',
          resource: 'checkout-cart',
          owner: app.id,
        },
        checkoutCartRemoveItem: {
          client: 'removeCheckoutCartItem',
          method: 'POST',
          path: '/effect/checkout/cart/remove',
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
  const checkoutCartOperations = serviceHasCheckoutCartState(target)
    ? {
        addCartItem: {
          method: 'POST',
          path: '/effect/checkout/cart/items',
          source: 'generated-client',
        },
        clearCart: {
          method: 'POST',
          path: '/effect/checkout/cart/clear',
          source: 'generated-client',
        },
        getCart: {
          method: 'GET',
          path: '/effect/checkout/cart',
          source: 'generated-client',
        },
        removeCartItem: {
          method: 'POST',
          path: '/effect/checkout/cart/remove',
          source: 'generated-client',
        },
      }
    : {};
  return {
    group: verticalEffectGroupName(target),
    notFound: verticalEffectNotFoundErrorExport(target),
    operations: {
      ...checkoutCartOperations,
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
