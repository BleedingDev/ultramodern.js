import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
} from '../backend-federation';
import {
  createBackendFederationName,
  resolveApiPrefix,
  resolveApiStem,
} from '../descriptors';
import { packageName } from '../naming';
import type { WorkspaceApi, WorkspaceApp } from '../types';
import {
  createCheckoutCartServerHandlers,
  createCheckoutCartServerState,
} from './checkout-cart';
import {
  verticalApiExport,
  verticalApiGroupName,
  verticalApiNotFoundErrorExport,
} from './names';
import { rpcServiceEntryWiring } from './rpc';

export function createApiServiceEntry(
  service: { id: string; api?: WorkspaceApi },
  contractImportPath: string,
): string {
  const apiExport = verticalApiExport(service);
  const groupName = verticalApiGroupName(service);
  const notFoundErrorExport = verticalApiNotFoundErrorExport(service);
  const stem = resolveApiStem(service);
  // G7c: for `rpc` services, splice an RPC group + handler layer + the `rpc`
  // field of `defineEffectBff`. Empty strings for the REST default so output
  // stays byte-identical.
  const rpc = rpcServiceEntryWiring(service);

  return `import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-edge';
${rpc.imports}import type {
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
${rpc.layer}
const apiRuntime: EffectBffDefinition<typeof ${apiExport}, EffectRuntimeLayer> &
  EffectBffRuntime<typeof ${apiExport}, EffectRuntimeLayer> = defineEffectBff({
  api: ${apiExport},
  layer,${rpc.field}
});

export default apiRuntime;
`;
}

export function createBackendEffectApiExpose(
  scope: string,
  service: WorkspaceApp,
): string {
  const apiExport = verticalApiExport(service);
  const groupName = verticalApiGroupName(service);
  const apiPrefix = resolveApiPrefix(service);
  const stem = resolveApiStem(service);

  return `import { ultramodernApiMarker } from '../shared/ultramodern-build.ts';
import { ${apiExport} } from '../shared/api.ts';

export const backendFederationContract = {
  compatibility: {
    build: ultramodernApiMarker.build,
    contractVersion: '${BACKEND_FEDERATION_CONTRACT_VERSION}',
    nodeAdapterVersion: '${BACKEND_FEDERATION_NODE_ADAPTER_VERSION}',
    packageName: '${packageName(scope, service.packageSuffix)}',
    sourceRevision: ultramodernApiMarker.sourceRevision,
    unitId: ultramodernApiMarker.unitId,
  },
  executionSurfaces: ['node-mf-runtime'],
  exposes: ['./effect-api'],
  name: '${createBackendFederationName(service)}',
  openapiPath: '${apiPrefix}/openapi.json',
  readinessPath: '${apiPrefix}/${stem}/readiness',
  role: 'microvertical-server',
  runtimeFramework: 'effect',
  strictEffectApproach: true,
} as const;

export { default, default as runtime } from './index.ts';
export {
  ${groupName}ApiContract as contract,
  ${groupName}OperationContexts as operationContexts,
} from '../shared/api.ts';
export const api: unknown = ${apiExport};
`;
}
