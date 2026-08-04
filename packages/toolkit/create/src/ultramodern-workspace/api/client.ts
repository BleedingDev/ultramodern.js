import {
  resolveApiProtocol,
  resolveApiStem,
  verticalApiApps,
} from '../descriptors';
import { packageName, toPascalCase } from '../naming';
import type { WorkspaceApi, WorkspaceApp } from '../types';
import {
  createCheckoutCartClientExports,
  serviceHasCheckoutCartState,
} from './checkout-cart';
import {
  verticalApiErrorStem,
  verticalApiExport,
  verticalApiGroupName,
  verticalApiNotFoundErrorExport,
} from './names';

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

export { Effect, runEffectRequest } from '@modern-js/plugin-bff/effect-client';

type ${pascalStem}ApiGroups = typeof ${apiExport} extends HttpApi.HttpApi<
  infer _ApiId,
  infer Groups
>
  ? Groups
  : never;

export type ${clientTypeName} = HttpApiClient.Client<
  Extract<${pascalStem}ApiGroups, HttpApiGroup.Constraint>,
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
      const rpc = resolveApiProtocol(remote) === 'rpc';
      const pascalSingular = toPascalCase(verticalApiErrorStem(remote));
      const checkoutCartExports =
        !rpc && serviceHasCheckoutCartState(remote)
          ? `  addCheckoutCartItem,
  clearCheckoutCart,
  getCheckoutCart,
  removeCheckoutCartItem,
  type CheckoutAddCartItemInput,
  type CheckoutCart,
  type CheckoutCartLine,
`
          : '';
      if (rpc) {
        return `export {
  get${pascalStem}Rpc,
  list${pascalStem}Rpc,
  make${pascalStem}RpcClient,
  type ${pascalStem}RpcClientOptions,
} from '${packageName(scope, remote.packageSuffix)}/api/rpc-client';`;
      }
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
