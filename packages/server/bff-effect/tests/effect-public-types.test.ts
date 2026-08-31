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
  Schema,
  makeEffectHttpApiClient,
} from '@modern-js/bff-effect/effect-client';
import { defineEffectBff, Layer } from '@modern-js/bff-effect/effect';
import type {
  EffectApiClientFromApi,
  EffectBffDefinition,
  EffectBffRuntime,
  EffectRuntimeLayer,
} from '@modern-js/bff-effect/effect';

const PingApi = HttpApi.make('PingApi').add(
  HttpApiGroup.make('ping', { topLevel: true }).add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  ),
);

const clientEffect = makeEffectHttpApiClient(PingApi);

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

const api = HttpApi.make('StrictApi');
const layer = Layer.empty satisfies EffectRuntimeLayer;
const runtime: EffectBffDefinition<typeof api, EffectRuntimeLayer> &
  EffectBffRuntime<typeof api, EffectRuntimeLayer> = defineEffectBff({
  api,
  layer,
});

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
        compilerPath,
        ['--project', path.join(fixtureRoot, 'tsconfig.json')],
        {
          encoding: 'utf8',
        },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
