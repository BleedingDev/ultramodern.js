import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');
const requireCjs = createRequire(import.meta.url);

describe('@modern-js/bff-effect public types', () => {
  test('preserves requirement-free clients and exact optional definitions', () => {
    const fixtureRoot = mkdtempSync(
      path.join(tmpdir(), 'bff-effect-public-types-'),
    );

    try {
      const packageLinkParent = path.join(
        fixtureRoot,
        'node_modules/@modern-js',
      );
      mkdirSync(packageLinkParent, { recursive: true });
      symlinkSync(
        packageRoot,
        path.join(packageLinkParent, 'bff-effect'),
        'dir',
      );

      writeFileSync(
        path.join(fixtureRoot, 'index.ts'),
        `import {
  Effect,
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Rpc,
  RpcGroup,
  Schema,
  makeEffectHttpApiClient,
  makeEffectRpcClient,
} from '@modern-js/bff-effect/effect-client';
import { defineEffectBff, Layer } from '@modern-js/bff-effect/effect';
import type {
  EffectApiClientFromApi,
  EffectBffDefinition,
  EffectBffRuntime,
  EffectDataPlatformBatchOptions,
  EffectRuntimeLayer,
} from '@modern-js/bff-effect/effect';

import {
  createMicroVerticalOperationContext,
  MicroVerticalReadinessSchema,
  type MicroVerticalBuildMarker,
  type MicroVerticalOperationContext,
  type MicroVerticalOperationSource,
  type MicroVerticalReadiness,
} from '@modern-js/bff-effect/microvertical-api';

const operation = createMicroVerticalOperationContext({
  method: 'GET', operationId: 'catalog.list', routePath: '/catalog',
});
const method: 'GET' = operation.method;
const operationId: 'catalog.list' = operation.operationId;
const routePath: '/catalog' = operation.routePath;
const source: 'generated-client' = operation.source;
const compatible: MicroVerticalOperationContext = operation;
const operationSource: MicroVerticalOperationSource = source;
// @ts-expect-error traceId is an optional key, not an explicit undefined value
const invalidTrace: MicroVerticalOperationContext = { ...operation, traceId: undefined };
// @ts-expect-error generated-client inference is readonly
operation.method = 'GET';
const consumerReadiness = Schema.Struct({
  ...MicroVerticalReadinessSchema.fields,
  database: Schema.Literal('ready'),
});
declare const healthy: typeof consumerReadiness.Type;
const readiness: MicroVerticalReadiness = healthy;
const marker: MicroVerticalBuildMarker = healthy.marker;
const appId: string = marker.appId;
// @ts-expect-error validator brands are not public baseline exports
import { MicroVerticalAppIdSchema } from '@modern-js/bff-effect/microvertical-api';

const PingApi = HttpApi.make('PingApi').add(
  HttpApiGroup.make('ping', { topLevel: true }).add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  ),
);

const clientEffect = makeEffectHttpApiClient(PingApi);

const InventoryApi = HttpApi.make('Inventory').add(
  HttpApiGroup.make('items').add(
    HttpApiEndpoint.post('create', '/items/:id', {
      params: { id: Schema.String },
      query: { count: Schema.FiniteFromString },
      payload: Schema.Struct({ title: Schema.String }),
      success: Schema.Struct({ id: Schema.String, count: Schema.Number }),
    }),
  ),
);
const inventory = makeEffectHttpApiClient(InventoryApi);
Effect.gen(function* () {
  const client = yield* inventory;
  const request = { params: { id: '42' }, query: { count: 3 }, payload: { title: 'native' } };
  const result = yield* client.items.create(request);
  const id: string = result.id;
  const count: number = result.count;
  // @ts-expect-error response fields are inferred from the contract
  const wrongResult: string = result.count;
  // @ts-expect-error payload fields are inferred from the contract
  client.items.create({ ...request, payload: { title: 123 } });
  // @ts-expect-error required payload cannot be omitted
  client.items.create({ params: { id: '42' }, query: { count: 3 } });
  // @ts-expect-error transformed query input uses its decoded number type
  client.items.create({ ...request, query: { count: '3' } });
  // @ts-expect-error path parameters retain their contract types
  client.items.create({ ...request, params: { id: 42 } });
  // @ts-expect-error undeclared endpoints are not present
  client.items.destroy({});
});


type IsAny<T> = 0 extends 1 & T ? true : false;
type IsNever<T> = IsAny<T> extends true
  ? false
  : [T] extends [never]
    ? true
    : false;
type Assert<T extends true> = T;
type EffectRequirements<T> = T extends Effect.Effect<
  unknown,
  unknown,
  infer Requirements
>
  ? Requirements
  : never;
type EffectSuccess<T> = T extends Effect.Effect<
  infer Success,
  unknown,
  unknown
>
  ? Success
  : never;
type EffectError<T> = T extends Effect.Effect<unknown, infer Error, unknown>
  ? Error
  : never;
type IsUnknown<T> = unknown extends T ? true : false;

type Client = EffectSuccess<typeof clientEffect>;
type ServerHelperClient = EffectApiClientFromApi<typeof PingApi>;
type ClientConstructionRequirements = EffectRequirements<typeof clientEffect>;
type PingMethodRequirements = EffectRequirements<ReturnType<Client['ping']>>;
type ServerHelperPingMethodRequirements = EffectRequirements<
  ReturnType<ServerHelperClient['ping']>
>;

type _ClientConstructionRequirementsAreNever = Assert<
  IsNever<ClientConstructionRequirements>
>;
type _PingMethodRequirementsAreNever = Assert<IsNever<PingMethodRequirements>>;
type _ServerHelperPingMethodRequirementsAreNever = Assert<
  IsNever<ServerHelperPingMethodRequirements>
>;

const rpcGroup = RpcGroup.make(Rpc.make('get', {
  error: Schema.String,
  payload: { id: Schema.String },
  success: Schema.String,
}));
const rpcClientEffect = makeEffectRpcClient(rpcGroup, { url: '/rpc' });
type RpcClient = EffectSuccess<typeof rpcClientEffect>;
type RpcCallError = EffectError<ReturnType<RpcClient['get']>>;
type _RpcCallErrorIsSpecific = Assert<IsUnknown<RpcCallError> extends false ? true : false>;
type _RpcCallRetainsDomainError = Assert<IsNever<Extract<RpcCallError, string>> extends false ? true : false>;
type _RpcCallRetainsTransportError = Assert<IsNever<Extract<RpcCallError, { _tag: 'RpcClientError' }>> extends false ? true : false>;

const api = HttpApi.make('StrictApi');
const layer = Layer.empty satisfies EffectRuntimeLayer;
const runtime: EffectBffDefinition<typeof api, EffectRuntimeLayer> &
  EffectBffRuntime<typeof api, EffectRuntimeLayer> = defineEffectBff({
  api,
  layer,
});

// @ts-expect-error a server definition does not pretend to contain a client
runtime.client;
// @ts-expect-error server configuration no longer carries client codegen options
const removedBatchOption: EffectDataPlatformBatchOptions = { flushIntervalMs: 8 };
void runtime;
`,
      );

      const nodeTypesManifestPath = requireCjs.resolve(
        '@types/node/package.json',
      );
      const reactTypesManifestPath = requireCjs.resolve(
        '@types/react/package.json',
      );
      writeFileSync(
        path.join(fixtureRoot, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              exactOptionalPropertyTypes: true,
              isolatedModules: true,
              lib: ['DOM', 'ESNext'],
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              skipLibCheck: false,
              strict: true,
              target: 'ES2024',
              typeRoots: [
                path.dirname(path.dirname(nodeTypesManifestPath)),
                path.dirname(path.dirname(reactTypesManifestPath)),
              ],
              types: ['node', 'react'],
            },
            include: ['index.ts'],
          },
          null,
          2,
        )}\n`,
      );

      const compilerManifestPath = requireCjs.resolve(
        '@typescript/native-preview/package.json',
      );
      const compilerManifest = JSON.parse(
        readFileSync(compilerManifestPath, 'utf8'),
      ) as { bin: { tsgo: string } };
      const compilerPath = path.resolve(
        path.dirname(compilerManifestPath),
        compilerManifest.bin.tsgo,
      );
      const result = spawnSync(
        process.execPath,
        [compilerPath, '--project', path.join(fixtureRoot, 'tsconfig.json')],
        {
          encoding: 'utf8',
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
