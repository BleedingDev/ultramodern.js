/**
 * Effect RPC API generation (G7c). When a vertical's API protocol is `rpc`
 * (see {@link resolveApiProtocol}), the generator emits one Effect RPC
 * contract/handler/client surface, mirroring the shapes that plugin-bff's RPC
 * runtime accepts
 * (`packages/cli/plugin-bff/src/runtime/effect/handler/rpc.ts` + `types.ts`):
 * an `RpcGroup` contract, a handler `Layer` provided through the `rpc` field of
 * `defineEffectBff` ({@link EffectRpcBffDefinition}), and the public
 * `makeEffectRpcClient` primitive.
 *
 * REST output is untouched (byte-identical) and is generated only for `rest`
 * apps. GraphQL is intentionally NOT implemented; the protocol SPI shape
 * leaves room to add it later.
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

/** Path after the BFF prefix has been stripped by the Effect adapter. */
export const RPC_ROUTE_PATH = '/rpc' as const;

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

export class ${notFound} extends Schema.TaggedError<${notFound}>()(
  '${notFound}',
  {
  id: Schema.String,
  },
) {}

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
 * Service-entry wiring for an RPC service. Returns snippets the RPC-only
 * service entry splices into `defineEffectBff(...)`. Empty strings for REST
 * services.
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
const ${groupName}RpcLayer = ${groupExport}.toLayer(
  ${groupExport}.of({
    list: ({ limit }) =>
      Effect.succeed({
        items:
          typeof limit === 'number'
            ? ${groupName}Items.slice(0, limit).map(item => ({
                id: item.id,
                title: item.title,
              }))
            : ${groupName}Items.map(item => ({
                id: item.id,
                title: item.title,
              })),
      }),
    get: ({ id }) => {
      const matched = ${groupName}Items.find(candidate => candidate.id === id);
      return matched === undefined
        ? Effect.fail(new ${notFound}({ id }))
        : Effect.succeed({ id: matched.id, title: matched.title });
    },
  }),
);
`;
  const field = `
  rpc: {
    group: ${groupExport},
    layer: ${groupName}RpcLayer,
    path: '${RPC_ROUTE_PATH}',
    serialization: 'json',
  },`;

  return { imports, layer, field };
}

/**
 * Generate the RPC-only BFF entry. `defineEffectBff` is retained as the outer
 * public entry shape so the strict Effect adapter applies its validator and
 * lifecycle handling. The transport HttpApi has no endpoints; all callable
 * surface is mounted by the `rpc` definition.
 */
export function createRpcApiServiceEntry(service: ApiService): string {
  const groupName = verticalApiGroupName(service);
  const groupExport = verticalRpcGroupExport(service);
  const rpc = rpcServiceEntryWiring(service);
  const stem = resolveApiStem(service);

  return `import {
  defineEffectBff,
  Effect,
  HttpApi,
  Layer,
} from '@modern-js/plugin-bff/effect-edge';
${rpc.imports}import { ultramodernApiMarker } from '../shared/ultramodern-build.ts';

const ${groupName}Items = [
  {
    id: 'starter-${stem}',
    marker: ultramodernApiMarker,
    title: 'Wire a real ${stem} source here',
  },
];

${rpc.layer}

// Strict Effect uses this empty transport marker to discover the BFF entry.
// It has no REST groups/endpoints; the canonical network surface is RPC.
const rpcTransport = HttpApi.make('${groupName}RpcTransport');
const layer = Layer.empty;

const apiRuntime = defineEffectBff({
  api: rpcTransport,
  layer,
${rpc.field}
});

export { ${groupExport} };
export default apiRuntime;
`;
}

/**
 * Generate the RPC client file (`src/api/${stem}-rpc-client.ts`) built from the
 * shared `RpcGroup` through plugin-bff's public HTTP RPC client primitive.
 */
export function createRpcClientFile(service: ApiService): string {
  const groupExport = verticalRpcGroupExport(service);
  const contractExport = verticalRpcContractExport(service);
  const stem = resolveApiStem(service);
  const pascalStem = toPascalCase(stem);

  return `import {
  Effect,
  makeEffectRpcClient,
} from '@modern-js/plugin-bff/effect-client';
import {
  ${contractExport},
  ${groupExport},
} from '../../shared/rpc.ts';

export { Effect } from '@modern-js/plugin-bff/effect-client';

export const ${pascalStem}RpcContract = ${contractExport};

export interface ${pascalStem}RpcClientOptions {
  url?: string | URL;
}

export const make${pascalStem}RpcClient = (
  options: ${pascalStem}RpcClientOptions = {},
) =>
  makeEffectRpcClient(${groupExport}, {
    url: String(options.url ?? ${contractExport}.path),
    serialization: 'json',
  });

export const list${pascalStem}Rpc = (
  limit?: number,
  options: ${pascalStem}RpcClientOptions = {},
) =>
  Effect.acquireUseRelease(
    make${pascalStem}RpcClient(options),
    client => client.list({ limit }),
    client => Effect.promise(() => client.dispose()),
  );

export const get${pascalStem}Rpc = (
  id: string,
  options: ${pascalStem}RpcClientOptions = {},
) =>
  Effect.acquireUseRelease(
    make${pascalStem}RpcClient(options),
    client => client.get({ id }),
    client => Effect.promise(() => client.dispose()),
  );
`;
}
