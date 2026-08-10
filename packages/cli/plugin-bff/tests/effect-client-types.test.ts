import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');

describe('Effect public types', () => {
  test('makeEffectHttpApiClient keeps no-middleware clients requirement-free', () => {
    const tempDir = fs.mkdtempSync(
      path.join(packageRoot, 'tests/.tmp-effect-client-types-'),
    );

    try {
      fs.writeFileSync(
        path.join(tempDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              esModuleInterop: true,
              isolatedModules: true,
              lib: ['ES2022', 'ESNext.Disposable', 'DOM'],
              module: 'ESNext',
              moduleResolution: 'Bundler',
              noEmit: true,
              skipLibCheck: true,
              strict: true,
              target: 'ES2022',
              types: ['node', 'react'],
            },
            include: ['input.ts'],
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(tempDir, 'input.ts'),
        `import {
  Effect,
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
  makeEffectHttpApiClient,
} from '../../src/runtime/effect-client';
import type { EffectApiClientFromApi } from '../../src/runtime/effect';

const PingApi = HttpApi.make('PingApi').add(
  HttpApiGroup.make('ping', { topLevel: true }).add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  ),
);

const clientEffect = makeEffectHttpApiClient(PingApi);

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsNever<T> = IsAny<T> extends true ? false : [T] extends [never] ? true : false;
type Assert<T extends true> = T;
type EffectRequirements<T> = T extends Effect.Effect<unknown, unknown, infer Requirements>
  ? Requirements
  : never;
type EffectSuccess<T> = T extends Effect.Effect<infer Success, unknown, unknown>
  ? Success
  : never;

type Client = EffectSuccess<typeof clientEffect>;
type ServerHelperClient = EffectApiClientFromApi<typeof PingApi>;
type ClientConstructionRequirements = EffectRequirements<typeof clientEffect>;
type PingMethodRequirements = EffectRequirements<ReturnType<Client['ping']>>;
type ServerHelperPingMethodRequirements = EffectRequirements<
  ReturnType<ServerHelperClient['ping']>
>;

type _ClientConstructionRequirementsAreNever =
  Assert<IsNever<ClientConstructionRequirements>>;
type _PingMethodRequirementsAreNever = Assert<IsNever<PingMethodRequirements>>;
type _ServerHelperPingMethodRequirementsAreNever =
  Assert<IsNever<ServerHelperPingMethodRequirements>>;
`,
      );

      const result = spawnSync(
        'pnpm',
        ['exec', 'tsgo', '--project', path.join(tempDir, 'tsconfig.json')],
        {
          cwd: packageRoot,
          encoding: 'utf-8',
        },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('defineEffectBff satisfies its public definition under exact optional types', () => {
    const tempDir = fs.mkdtempSync(
      path.join(packageRoot, 'tests/.tmp-effect-definition-types-'),
    );

    try {
      fs.writeFileSync(
        path.join(tempDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              exactOptionalPropertyTypes: true,
              isolatedModules: true,
              lib: ['ES2022', 'ESNext.Disposable', 'DOM'],
              module: 'ESNext',
              moduleResolution: 'Bundler',
              noEmit: true,
              skipLibCheck: true,
              strict: true,
              target: 'ES2022',
              types: ['node'],
            },
            include: ['input.ts'],
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(tempDir, 'input.ts'),
        `import {
  defineEffectBff,
  HttpApi,
  Layer,
} from '../../dist/types/runtime/effect/edge';
import type {
  EffectBffDefinition,
  EffectBffRuntime,
  EffectRuntimeLayer,
} from '../../dist/types/runtime/effect/edge';

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

      const result = spawnSync(
        'pnpm',
        ['exec', 'tsgo', '--project', path.join(tempDir, 'tsconfig.json')],
        {
          cwd: packageRoot,
          encoding: 'utf-8',
        },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
