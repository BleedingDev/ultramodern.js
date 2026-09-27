import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BffGeneratedEntries, BffGeneration } from '@modern-js/app-tools';
import { bffPlugin as nativeBffPlugin } from '../../plugin-bff/src/cli';
import { createBffGenerator } from '../../plugin-bff/src/cli/generator';
import type { APILoaderOptions } from '../../plugin-bff/src/utils/clientGenerator';
import { createProducerClient } from '../../plugin-bff-extensions/src/cross-project-policy/producer-runtime';
import {
  type BffGenerationMetadata,
  registerBffClientArtifacts,
} from '../src/client-artifacts';
import { registerBffGeneratedEntries } from '../src/generated-entries';

async function render(
  appDirectory: string,
  moduleType: 'commonjs' | 'module' = 'commonjs',
  runtimeCreateRequest?: string,
) {
  const hooks = nativeBffPlugin().registryHooks!;
  const generation: BffGeneration = {
    appDirectory,
    apiDirectory: path.join(appDirectory, 'api'),
    lambdaDirectory: path.join(appDirectory, 'api/lambda'),
    existLambda: false,
    apiFiles: [],
    relativeDistPath: 'dist',
    prefix: '/api',
    requestId: 'runtime-app',
  };
  const metadata = new WeakMap<BffGeneration, BffGenerationMetadata>();
  metadata.set(generation, {
    runtimeFramework: 'hono',
    relativeEffectEntry: '',
    operationContracts: {
      'GET:/api/ping': { schemaHash: 'generated', operationVersion: 1 },
    },
  });
  registerBffGeneratedEntries(
    {
      getAppContext: () => ({ moduleType }),
      getNormalizedConfig: () => ({ bff: { runtimeCreateRequest } }),
      modifyBffGeneratedEntries: hooks.modifyBffGeneratedEntries.tap,
    } as never,
    metadata,
  );
  return hooks.modifyBffGeneratedEntries.call({
    generation,
    plugin: { code: '', declaration: '' },
    runtime: { code: '', declaration: '' },
    packageDependencies: {},
  }) as Promise<BffGeneratedEntries>;
}

async function clientGenerator(
  options: APILoaderOptions & { bffRuntimeFramework: 'effect' },
) {
  const hooks = nativeBffPlugin().registryHooks!;
  const api = {
    getHooks: () => hooks,
    getAppContext: () => ({
      appDirectory: options.appDir,
      apiDirectory: options.apiDir,
      lambdaDirectory: options.lambdaDir,
      port: options.port,
      bffRuntimeFramework: 'effect',
    }),
    getNormalizedConfig: () => ({
      bff: { runtimeFramework: 'effect' },
      output: { distPath: { root: options.relativeDistPath } },
    }),
    modifyBffClientArtifacts: hooks.modifyBffClientArtifacts.tap,
    modifyBffGeneratedEntries: hooks.modifyBffGeneratedEntries.tap,
  };
  const metadata = new WeakMap<BffGeneration, BffGenerationMetadata>();
  registerBffClientArtifacts(api as never, metadata);
  registerBffGeneratedEntries(api as never, metadata);
  await createBffGenerator(api as never).generate();
}

describe('fork producer generated entries', () => {
  test('Effect producer build emits server entries without generating client code or client exports', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-client-module-'),
    );
    try {
      const apiDir = path.join(appDir, 'api');
      const lambdaDir = path.join(apiDir, 'lambda');
      await fs.promises.mkdir(apiDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify(
          {
            name: 'module-app',
            version: '1.0.0',
            exports: {
              './runtime': {
                import: './.modern-js/runtime/index.js',
                types: './.modern-js/runtime/index.d.ts',
              },
            },
            typesVersions: {
              '*': { runtime: ['./.modern-js/runtime/index.d.ts'] },
            },
          },
          null,
          2,
        ),
      );
      await fs.promises.writeFile(
        path.join(apiDir, 'index.js'),
        `const {
          HttpApi,
          HttpApiEndpoint,
          HttpApiGroup,
          Layer,
          Schema,
        } = require('@modern-js/bff-effect/effect-client');

const api = HttpApi.make('ModuleApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({
        ok: Schema.Boolean,
      }),
    }),
  ),
);

        module.exports = { api, layer: Layer.empty };
        `,
      );

      await fs.promises.mkdir(path.join(appDir, '.modern-js', 'runtime'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(appDir, '.modern-js', 'runtime', 'index.js'),
        'exports.configure = () => {};',
      );

      await clientGenerator({
        prefix: '/api',
        appDir,
        apiDir,
        lambdaDir,
        existLambda: false,
        port: 8080,
        relativeDistPath: '.modern-js',
        relativeApiPath: './api',
        apiFiles: [],
        bffRuntimeFramework: 'effect',
      });

      expect(fs.existsSync(path.join(appDir, '.modern-js', 'client'))).toBe(
        false,
      );
      const manifest = JSON.parse(
        await fs.promises.readFile(path.join(appDir, 'package.json'), 'utf8'),
      );
      expect(manifest.exports).not.toHaveProperty('./api/*');
      expect(manifest.exports).not.toHaveProperty('./runtime');
      expect(manifest.typesVersions['*']).not.toHaveProperty('runtime');
      expect(fs.existsSync(path.join(appDir, '.modern-js', 'runtime'))).toBe(
        false,
      );
      expect(manifest.typesVersions['*']).not.toHaveProperty('api/*');
      expect(
        fs.existsSync(path.join(appDir, '.modern-js', 'plugin', 'index.js')),
      ).toBe(true);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('emitted bootstrap invokes the owning defaults helper and preserves nested overrides', async () => {
    const appDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'bff-render-'),
    );
    try {
      await fs.promises.writeFile(
        path.join(appDirectory, 'package.json'),
        JSON.stringify({
          name: 'runtime-app',
          devDependencies: {
            '@modern-js/plugin-bff-build-extensions': '3.8.3',
            '@modern-js/plugin-bff-extensions': '3.8.3',
          },
        }),
      );
      const entries = await render(
        appDirectory,
        'commonjs',
        '@fixture/request',
      );
      const imported: string[] = [];
      const exports: Record<string, any> = {};
      const load = (name: string) => {
        imported.push(name);
        if (name === '@fixture/request')
          return { configure: (options: unknown) => options };
        if (name === '@modern-js/plugin-bff-extensions/producer-runtime')
          return { createProducerClient };
        throw new Error(`Unexpected generated import ${name}`);
      };
      new Function('require', 'exports', entries.runtime.code)(load, exports);
      expect(imported).toEqual([
        '@fixture/request',
        '@modern-js/plugin-bff-extensions/producer-runtime',
      ]);
      expect(exports.configure).toBe(exports.initProducerClient);
      expect(
        exports.configure({
          requestId: 'override',
          identityBinding: { strict: false },
          operationContract: { requireSchemaHash: false },
        }),
      ).toEqual({
        requestId: 'override',
        requireEnvelope: true,
        identityBinding: { enabled: true, strict: false },
        operationContract: {
          enabled: true,
          strict: true,
          requireSchemaHash: false,
          requireOperationVersion: true,
        },
      });
      expect(entries.packageDependencies).toEqual({
        '@modern-js/plugin-bff-build-extensions': '3.8.3',
        '@modern-js/plugin-bff-extensions': '3.8.3',
      });
      expect(entries.plugin.code).not.toContain('crossProjectPolicy');
    } finally {
      await fs.promises.rm(appDirectory, { recursive: true, force: true });
    }
  });

  test.each([
    'commonjs',
    'module',
  ] as const)('published %s producer modules load with actual package exports', async moduleType => {
    const appDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'bff-published-'),
    );
    try {
      await fs.promises.writeFile(
        path.join(appDirectory, 'package.json'),
        JSON.stringify({ name: 'runtime-app', type: moduleType }),
      );
      for (const name of [
        'plugin-bff-build-extensions',
        'plugin-bff-extensions',
      ]) {
        const target = path.join(appDirectory, 'node_modules/@modern-js', name);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.symlink(
          path.resolve(__dirname, '../..', name),
          target,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
      const requestModule = path.join(appDirectory, 'request.mjs');
      await fs.promises.writeFile(
        requestModule,
        'export const configure = options => options;',
      );
      const entries = await render(appDirectory, moduleType, requestModule);
      if (moduleType === 'module')
        expect(entries.runtime.code).toContain(
          JSON.stringify(pathToFileURL(requestModule).href),
        );
      const runtimeFile = path.join(appDirectory, 'runtime.js');
      const pluginFile = path.join(appDirectory, 'plugin.js');
      await fs.promises.writeFile(runtimeFile, entries.runtime.code);
      await fs.promises.writeFile(pluginFile, entries.plugin.code);
      const runtime = await import(
        /* webpackIgnore: true */ pathToFileURL(runtimeFile).href
      );
      const plugin = await import(
        /* webpackIgnore: true */ pathToFileURL(pluginFile).href
      );
      expect(runtime.configure).toBe(runtime.initProducerClient);
      expect(runtime.configure()).toMatchObject({
        requestId: 'runtime-app',
        requireEnvelope: true,
      });
      expect(plugin.crossProjectApiPlugin().name).toBe(
        '@modern-js/plugin-independent-bff',
      );
    } finally {
      await fs.promises.rm(appDirectory, { recursive: true, force: true });
    }
  });
});
