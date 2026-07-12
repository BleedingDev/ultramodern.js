import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServerPluginAPI } from '@modern-js/server-core';
import apiLoader, { type APILoaderOptions } from '../src/loader';
import { EffectAdapter } from '../src/runtime/effect/adapter';
import { generateEffectClient } from '../src/utils/effectClientGenerator';
import { loadEffectSourceModule } from '../src/utils/effectSourceLoader';

const require = createRequire(import.meta.url);

const writeFile = async (filename: string, source: string) => {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true });
  await fs.promises.writeFile(filename, source);
};

const writeEmptyPathsTsconfig = (appDir: string) =>
  writeFile(
    path.join(appDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          paths: {},
        },
      },
      null,
      2,
    ),
  );

const linkFixturePackage = async (appDir: string, packageName: string) => {
  const packageDirectory = path.dirname(
    require.resolve(`${packageName}/package.json`),
  );
  const packagePath = path.join(appDir, 'node_modules', packageName);
  await fs.promises.mkdir(path.dirname(packagePath), { recursive: true });
  await fs.promises.symlink(
    packageDirectory,
    packagePath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
};

describe('Effect source graph loading', () => {
  test('preserves native ESM semantics, TS path precedence, and automatic JSX', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-esm-'),
    );

    try {
      await linkFixturePackage(appDir, 'react');
      const entryFile = path.join(appDir, 'src', 'entry.tsx');
      const componentFile = path.join(appDir, 'src', 'component.tsx');
      const specificFile = path.join(appDir, 'specific', 'value.ts');
      const broadFile = path.join(appDir, 'fallback', 'specific', 'value.ts');
      await writeFile(
        path.join(appDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            jsx: 'preserve',
            paths: {
              '@/*': ['fallback/*'],
              '@/specific/*': ['specific/*'],
            },
          },
        }),
      );
      await writeFile(
        path.join(appDir, 'node_modules', 'esm-only-fixture', 'package.json'),
        JSON.stringify({
          name: 'esm-only-fixture',
          type: 'module',
          exports: './index.mjs',
        }),
      );
      await writeFile(
        path.join(appDir, 'node_modules', 'esm-only-fixture', 'index.mjs'),
        `export const esmValue = await Promise.resolve('esm-only');`,
      );
      await writeFile(broadFile, `export const selected = 'broad-alias';`);
      await writeFile(
        specificFile,
        `export const selected = await Promise.resolve('specific-alias');`,
      );
      await writeFile(
        componentFile,
        `export const view = <section data-runtime="automatic" />;`,
      );
      await writeFile(
        entryFile,
        `import { esmValue } from 'esm-only-fixture';
import { selected } from '@/specific/value';
import { view } from './component.js';

export const result = {
  esmValue,
  selected,
  sourceUrl: import.meta.url,
  viewType: view.type,
};`,
      );

      const dependencies: string[] = [];
      const loaded = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryFile,
        onDependency: dependency => dependencies.push(dependency),
      })) as {
        result: {
          esmValue: string;
          selected: string;
          sourceUrl: string;
          viewType: string;
        };
      };
      const canonicalEntryFile = await fs.promises.realpath(entryFile);

      expect(loaded.result).toEqual({
        esmValue: 'esm-only',
        selected: 'specific-alias',
        sourceUrl: pathToFileURL(canonicalEntryFile).href,
        viewType: 'section',
      });
      expect(new Set(dependencies)).toEqual(
        new Set([entryFile, componentFile, specificFile]),
      );
      expect(dependencies).not.toContain(broadFile);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('resolves baseUrl modules when tsconfig paths is empty', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-base-url-'),
    );

    try {
      const entryFile = path.join(appDir, 'entry.ts');
      const baseModule = path.join(appDir, 'src', 'base-value.ts');
      await writeFile(
        path.join(appDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            baseUrl: './src',
            paths: {},
          },
        }),
      );
      await writeFile(baseModule, `export const value = 'from-base-url';`);
      await writeFile(
        entryFile,
        `import { value } from 'base-value'; export { value };`,
      );

      const loaded = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryFile,
      })) as { value: string };
      expect(loaded.value).toBe('from-base-url');
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('normalizes TypeScript CommonJS output to its ESM namespace', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-commonjs-'),
    );

    try {
      const entryFile = path.join(appDir, 'dist', 'api', 'effect', 'index.js');
      const contractFile = path.join(appDir, 'dist', 'shared', 'contract.js');
      await writeEmptyPathsTsconfig(appDir);
      await writeFile(
        contractFile,
        `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kind = "effect-definition";`,
      );
      await writeFile(
        entryFile,
        `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const contract = require("../../shared/contract");
exports.named = "compiled-commonjs";
exports.default = { kind: contract.kind };`,
      );

      const loaded = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryFile,
      })) as {
        default: { kind: string };
        named: string;
      };

      expect(loaded.default).toEqual({ kind: 'effect-definition' });
      expect(loaded.named).toBe('compiled-commonjs');
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('codegen compiles a typed relative ESM contract without a JavaScript twin', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-codegen-'),
    );

    try {
      await linkFixturePackage(appDir, 'effect');
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'effect', 'index.ts');
      const contractFile = path.join(appDir, 'shared', 'effect', 'api.ts');
      await writeEmptyPathsTsconfig(appDir);
      await writeFile(
        contractFile,
        `import * as Schema from 'effect/Schema';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/unstable/httpapi';

export const contractApi = HttpApi.make('TypedSourceGraphApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  ),
);`,
      );
      await writeFile(
        entryFile,
        `import * as Layer from 'effect/Layer';
import { contractApi } from '../../shared/effect/api.js';

export const api = contractApi;
export const layer = Layer.empty;`,
      );

      const dependencies: string[] = [];
      const artifacts = await generateEffectClient({
        appDir,
        apiDir,
        resourcePath: entryFile,
        prefix: '/api',
        port: 8080,
        onDependency: dependency => dependencies.push(dependency),
      });

      expect(artifacts?.endpoints).toEqual([
        {
          apiId: 'TypedSourceGraphApi',
          endpointName: 'ping',
          groupName: 'greetings',
          method: 'GET',
          routePath: '/api/ping',
        },
      ]);
      expect(new Set(dependencies)).toEqual(
        new Set([path.resolve(entryFile), path.resolve(contractFile)]),
      );
      expect(fs.existsSync(contractFile.replace(/\.ts$/u, '.mjs'))).toBe(false);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('Rspack loader registers the complete typed graph with its watcher', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-watch-'),
    );

    try {
      await linkFixturePackage(appDir, 'effect');
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'effect', 'index.ts');
      const contractFile = path.join(apiDir, 'effect', 'contract.ts');
      await writeEmptyPathsTsconfig(appDir);
      await writeFile(
        contractFile,
        `import * as Schema from 'effect/Schema';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
export const api = HttpApi.make('WatchApi').add(
  HttpApiGroup.make('watch').add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  ),
);`,
      );
      await writeFile(entryFile, `export { api } from './contract.js';`);

      const dependencies: string[] = [];
      const options: APILoaderOptions = {
        apiDir,
        appDir,
        bffRuntimeFramework: 'effect',
        effectEntry: entryFile,
        existLambda: false,
        lambdaDir: path.join(apiDir, 'lambda'),
        port: 8080,
        prefix: '/api',
        target: 'web',
      };
      let callbackError: Error | null | undefined;
      let callbackCode: string | Buffer | undefined;
      const completed = new Promise<void>(resolve => {
        const context = {
          addDependency: (dependency: string) => dependencies.push(dependency),
          async:
            () => (error: Error | null | undefined, code?: string | Buffer) => {
              callbackError = error;
              callbackCode = code;
              resolve();
            },
          cacheable: () => {},
          getOptions: () => options,
          resourcePath: entryFile,
          resourceQuery: '',
        };
        void apiLoader.call(
          context as never,
          fs.readFileSync(entryFile, 'utf8'),
        );
      });

      await completed;
      expect(callbackError).toBeUndefined();
      expect(callbackCode).toEqual(expect.any(String));
      expect(new Set(dependencies)).toEqual(new Set([entryFile, contractFile]));
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('dev reload recompiles changed modules in the typed source graph', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-reload-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'effect', 'index.ts');
      const contractFile = path.join(apiDir, 'effect', 'contract.ts');
      await writeEmptyPathsTsconfig(appDir);
      await writeFile(contractFile, `export const message = 'first graph';`);
      await writeFile(
        entryFile,
        `import { message } from './contract.js';

const createHandler = Object.assign(
  () => ({
    handler: () => new Response(message),
    dispose: async () => {},
  }),
  { [Symbol.for('modernjs.effect.validatorAware')]: true },
);

export { createHandler };`,
      );

      const api = {
        getServerContext() {
          return {
            appDirectory: appDir,
            apiDirectory: apiDir,
          };
        },
        getServerConfig() {
          return {
            bff: {
              effect: {
                entry: 'api/effect/index.ts',
              },
            },
          };
        },
      } as unknown as ServerPluginAPI;
      const adapter = new EffectAdapter(api);
      const adapterState = adapter as unknown as {
        disposeCurrentHandler: () => Promise<void>;
        handler: ((request: Request) => Promise<Response> | Response) | null;
        reloadHandler: () => Promise<void>;
      };

      await adapterState.reloadHandler();
      expect(adapterState.handler).not.toBeNull();
      await expect(
        Promise.resolve(
          adapterState.handler!(new Request('http://localhost/api/ping')),
        ).then(response => response.text()),
      ).resolves.toBe('first graph');

      await writeFile(contractFile, `export const message = 'second graph';`);
      await adapter.onApiHandlersUpdated();

      await expect(
        Promise.resolve(
          adapterState.handler!(new Request('http://localhost/api/ping')),
        ).then(response => response.text()),
      ).resolves.toBe('second graph');
      await adapterState.disposeCurrentHandler();
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
