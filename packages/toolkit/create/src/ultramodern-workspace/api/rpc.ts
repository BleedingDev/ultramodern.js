/**
 * Effect RPC API generation (G7c). When a vertical's API protocol is `rpc`
 * (see {@link resolveApiProtocol}), the generator emits an Effect RPC
 * contract/handlers/client ALONGSIDE the base HttpApi surface, mirroring the
 * shapes that plugin-bff's RPC runtime accepts
 * (`packages/cli/plugin-bff/src/runtime/effect/handler/rpc.ts` + `types.ts`):
 * an `RpcGroup` contract, a handler `Layer` provided through the `rpc` field of
 * `defineEffectBff` ({@link EffectRpcBffDefinition}), and an `RpcClient`.
 *
 * REST output is untouched (byte-identical). GraphQL is intentionally NOT
 * implemented; the protocol SPI shape leaves room to add it later.
 */
import { resolveApiPrefix, resolveApiStem } from '../descriptors';
import { toPascalCase } from '../naming';
import type { WorkspaceApi } from '../types';
import { verticalApiGroupName, verticalApiNotFoundErrorExport } from './names';

type ApiService = { id: string; api?: WorkspaceApi };

/** Export name of the generated `RpcGroup` for a service. */
export function verticalRpcGroupExport(service: ApiService): string {
  return `${verticalApiGroupName(service)}RpcGroup`;
}

/** Export name of the generated RPC contract metadata for a service. */
export function verticalRpcContractExport(service: ApiService): string {
  return `${verticalApiGroupName(service)}RpcContract`;
}

function rpcItemSchemaExport(service: ApiService): string {
  return `${verticalApiGroupName(service)}RpcItemSchema`;
}

/** Canonical RPC mount path for a service (under its API prefix). */
export function rpcPath(service: ApiService): string {
  return `${resolveApiPrefix(service)}/rpc`;
}

/**
 * Generate the `shared/rpc.ts` RPC contract: an `RpcGroup` of `list` / `get`
 * RPCs plus contract metadata. Mirrors `EffectRpcBffDefinition.group`.
 */
export function createRpcContractFile(service: ApiService): string {
  const groupName = verticalApiGroupName(service);
  const groupExport = verticalRpcGroupExport(service);
  const contractExport = verticalRpcContractExport(service);
  const itemSchema = rpcItemSchemaExport(service);
  const notFound = `${verticalApiNotFoundErrorExport(service)}Rpc`;
  const stem = resolveApiStem(service);
  const pascalStem = toPascalCase(stem);

  return `import { Rpc, RpcGroup } from 'effect/unstable/rpc';
import { Schema } from '@modern-js/plugin-bff/effect-client';

export interface ${pascalStem}RpcItem {
  readonly id: string;
  readonly title: string;
}

export const ${itemSchema}: Schema.Codec<${pascalStem}RpcItem> = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
});

export class ${notFound} extends Schema.ErrorClass<${notFound}>(
  '${notFound}',
)({
  _tag: Schema.tag('${notFound}'),
  id: Schema.String,
}) {}

// RpcGroup contract consumed by both the server handler layer and the client
// (mirrors the shapes plugin-bff's RpcServer/RpcClient runtime accepts).
export const ${groupExport} = RpcGroup.make(
  Rpc.make('list', {
    success: Schema.Struct({ items: Schema.Array(${itemSchema}) }),
    payload: { limit: Schema.optional(Schema.Number) },
  }),
  Rpc.make('get', {
    success: ${itemSchema},
    error: ${notFound},
    payload: { id: Schema.String },
  }),
);

export const ${contractExport} = {
  group: '${groupName}',
  path: '${rpcPath(service)}',
  protocol: 'rpc',
  serialization: 'json',
} as const;
`;
}

/**
 * Service-entry wiring for an RPC service. Returns snippets the HttpApi service
 * entry splices in so the emitted `defineEffectBff(...)` call carries an `rpc`
 * definition (group + handler layer + path + serialization), exactly the shape
 * {@link EffectRpcBffDefinition} accepts. Empty strings for REST services.
 */
export function rpcServiceEntryWiring(service: ApiService): {
  imports: string;
  layer: string;
  field: string;
} {
  if ((service.api?.protocol ?? 'rest') !== 'rpc') {
    return { imports: '', layer: '', field: '' };
  }

  const groupName = verticalApiGroupName(service);
  const groupExport = verticalRpcGroupExport(service);
  const notFound = `${verticalApiNotFoundErrorExport(service)}Rpc`;

  const imports = `import { ${groupExport}, ${notFound} } from '../shared/rpc.ts';
`;
  const layer = `
const ${groupName}RpcLayer = ${groupExport}.toLayer({
  list: ({ limit }) =>
    Effect.succeed({
      items:
        typeof limit === 'number'
          ? ${groupName}Items.slice(0, limit).map(item => ({
              id: item.id,
              title: item.title,
            }))
          : ${groupName}Items.map(item => ({ id: item.id, title: item.title })),
    }),
  get: ({ id }) => {
    const matched = ${groupName}Items.find(candidate => candidate.id === id);
    return matched === undefined
      ? Effect.fail(new ${notFound}({ id }))
      : Effect.succeed({ id: matched.id, title: matched.title });
  },
});
`;
  const field = `
  rpc: {
    group: ${groupExport},
    layer: ${groupName}RpcLayer,
    path: '${rpcPath(service)}',
    serialization: 'json',
  },`;

  return { imports, layer, field };
}

/**
 * Generate the RPC client file (`src/api/${stem}-rpc-client.ts`) built from the
 * shared `RpcGroup` (mirrors plugin-bff's `RpcClient` usage).
 */
export function createRpcClientFile(service: ApiService): string {
  const groupExport = verticalRpcGroupExport(service);
  const contractExport = verticalRpcContractExport(service);
  const stem = resolveApiStem(service);
  const pascalStem = toPascalCase(stem);

  return `import { RpcClient } from 'effect/unstable/rpc';
import { Effect } from '@modern-js/plugin-bff/effect-client';
import {
  ${contractExport},
  ${groupExport},
} from '../../shared/rpc.ts';

export { Effect } from '@modern-js/plugin-bff/effect-client';

export const ${pascalStem}RpcContract = ${contractExport};

export const make${pascalStem}RpcClient = () =>
  RpcClient.make(${groupExport});

export const list${pascalStem}Rpc = (limit?: number) =>
  make${pascalStem}RpcClient().pipe(
    Effect.flatMap(client => client.list({ limit })),
  );

export const get${pascalStem}Rpc = (id: string) =>
  make${pascalStem}RpcClient().pipe(
    Effect.flatMap(client => client.get({ id })),
  );
`;
}
