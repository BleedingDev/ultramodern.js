import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServerPluginAPI } from '@modern-js/server-core';
import apiLoader, { type APILoaderOptions } from '../src/loader';
import { EffectAdapter } from '../src/runtime/effect/adapter';
import { generateEffectClient } from '../src/utils/effectClientGenerator';
import {
  bundleEffectEntryForNode,
  loadEffectBuiltModule,
  loadEffectSourceModule,
} from '../src/utils/effectSourceLoader';

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

const runApiLoader = async ({
  options,
  resourcePath,
  resourceQuery,
  source,
}: {
  options: APILoaderOptions;
  resourcePath: string;
  resourceQuery: string;
  source: string;
}) => {
  let callbackError: Error | null | undefined;
  let callbackCode: string | Buffer | undefined;
  await new Promise<void>(resolve => {
    const context = {
      addDependency: () => {},
      async:
        () => (error: Error | null | undefined, code?: string | Buffer) => {
          callbackError = error;
          callbackCode = code;
          resolve();
        },
      cacheable: () => {},
      getOptions: () => options,
      resourcePath,
      resourceQuery,
    };
    void apiLoader.call(context as never, source);
  });

  if (callbackError) {
    throw callbackError;
  }
  return String(callbackCode);
};

const buildEffectWorkerRuntimeModule = async ({
  apiDir,
  appDir,
  entryFile,
  prefix,
  source,
}: {
  apiDir: string;
  appDir: string;
  entryFile: string;
  prefix: string;
  source: string;
}) => {
  const wrapperSource = await runApiLoader({
    options: {
      apiDir,
      appDir,
      bffRuntimeFramework: 'effect',
      effectEntry: entryFile,
      existLambda: false,
      lambdaDir: path.join(apiDir, 'lambda'),
      port: 8080,
      prefix,
      target: 'web',
    },
    resourcePath: entryFile,
    resourceQuery: '?modern-bff-runtime',
    source,
  });
  const wrapperFile = path.join(appDir, 'effect-worker-wrapper.mjs');
  const outputFile = path.join(appDir, 'effect-worker-runtime.mjs');
  await writeFile(wrapperFile, wrapperSource);

  const { build } = await import('esbuild');
  await build({
    alias: {
      '@modern-js/plugin-bff/effect-edge': path.resolve(
        __dirname,
        '../src/runtime/effect/edge.ts',
      ),
    },
    bundle: true,
    entryPoints: [wrapperFile],
    format: 'esm',
    outfile: outputFile,
    platform: 'node',
    target: 'node20',
  });

  return import(
    `${pathToFileURL(outputFile).href}?t=${Date.now()}`
  ) as Promise<{
    __modern_create_effect_bff_dispatcher: (options: {
      prefix?: string;
    }) => Promise<{
      dispatch: (
        request: Request,
        options?: { env?: Record<string, unknown> },
      ) => Promise<Response>;
      dispose: () => Promise<void>;
    }>;
  }>;
};

describe('Effect source graph loading', () => {
  test('keeps CommonJS Effect client and edge entrypoints on one runtime identity', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-runtime-identity-'),
    );

    try {
      const pluginManifest = JSON.parse(
        await fs.promises.readFile(
          path.join(__dirname, '../package.json'),
          'utf8',
        ),
      ) as {
        exports: Record<string, unknown>;
      };
      const pluginDirectory = path.join(
        appDir,
        'node_modules',
        '@modern-js',
        'plugin-bff',
      );
      const effectDirectory = path.join(appDir, 'node_modules', 'effect');
      const runtimeTargets = (value: unknown): string[] => {
        if (typeof value === 'string') {
          return value.endsWith('.d.ts') ? [] : [value];
        }
        if (value === null || typeof value !== 'object') {
          return [];
        }
        return Object.values(value).flatMap(runtimeTargets);
      };
      const writeRuntimeTargets = async (
        exportEntry: unknown,
        esmSource: string,
        commonJsSource: string,
      ) => {
        for (const target of new Set(runtimeTargets(exportEntry))) {
          await writeFile(
            path.join(pluginDirectory, target),
            target.endsWith('.mjs') ? esmSource : commonJsSource,
          );
        }
      };

      await writeFile(
        path.join(pluginDirectory, 'package.json'),
        JSON.stringify({
          name: '@modern-js/plugin-bff',
          exports: {
            './effect-client': pluginManifest.exports['./effect-client'],
            './effect-edge': pluginManifest.exports['./effect-edge'],
          },
        }),
      );
      await writeRuntimeTargets(
        pluginManifest.exports['./effect-client'],
        `import { missing } from 'effect/Schema';
export const makeSchema = () => ({ missing });`,
        `const { missing } = require('effect/Schema');
exports.makeSchema = () => ({ missing });`,
      );
      await writeRuntimeTargets(
        pluginManifest.exports['./effect-edge'],
        `import { missing } from 'effect/Schema';
export const decode = schema =>
  schema.missing === missing ? 'missing' : Number(schema.missing);`,
        `const { missing } = require('effect/Schema');
exports.decode = schema =>
  schema.missing === missing ? 'missing' : Number(schema.missing);`,
      );
      await writeFile(
        path.join(effectDirectory, 'package.json'),
        JSON.stringify({
          name: 'effect',
          type: 'module',
          exports: {
            './Schema': './Schema.js',
          },
        }),
      );
      await writeFile(
        path.join(effectDirectory, 'Schema.js'),
        `export const missing = Symbol('effect-schema-missing');`,
      );

      const entryPath = path.join(appDir, 'api.cjs');
      await writeFile(
        entryPath,
        `const client = require('@modern-js/plugin-bff/effect-client');
const edge = require('@modern-js/plugin-bff/effect-edge');
module.exports = edge.decode(client.makeSchema());`,
      );

      await bundleEffectEntryForNode({
        appDir,
        entryPath,
        format: 'cjs',
      });

      expect(createRequire(entryPath)(entryPath)).toBe('missing');
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('loads a built CommonJS Effect artifact without changing its native module boundary', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-built-commonjs-'),
    );

    try {
      const entryFile = path.join(appDir, 'dist', 'api', 'index.js');
      await writeFile(
        entryFile,
        `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
  filename: __filename,
  moduleType: "commonjs",
};`,
      );

      const loaded = (await loadEffectBuiltModule(entryFile)) as {
        default: { filename: string; moduleType: string };
      };

      expect(loaded.default).toEqual({
        filename: await fs.promises.realpath(entryFile),
        moduleType: 'commonjs',
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('loads a built ESM Effect artifact through its native module boundary', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-built-esm-'),
    );

    try {
      const entryFile = path.join(appDir, 'dist', 'api', 'index.js');
      await writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ type: 'module' }),
      );
      await writeFile(
        entryFile,
        `export default {
  moduleUrl: import.meta.url,
  moduleType: "module",
};`,
      );

      const loaded = (await loadEffectBuiltModule(entryFile)) as {
        default: { moduleType: string; moduleUrl: string };
      };

      expect(loaded.default).toEqual({
        moduleType: 'module',
        moduleUrl: pathToFileURL(await fs.promises.realpath(entryFile)).href,
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('emits an executable diagnostic module for platform-native paths', async () => {
    const resourcePath = String.raw`D:\a\ultramodern.js\app\api\effect\index.ts`;
    const code = await runApiLoader({
      options: {
        apiDir: String.raw`D:\a\ultramodern.js\app\api`,
        appDir: String.raw`D:\a\ultramodern.js\app`,
        existLambda: false,
        lambdaDir: String.raw`D:\a\ultramodern.js\app\api\lambda`,
        port: 8080,
        prefix: '/api',
        target: 'web',
      },
      resourcePath,
      resourceQuery: '',
      source: 'export const invalid = true;',
    });

    expect(() => Function(code)()).toThrow(
      `The file ${resourcePath} is not allowed to be imported in src directory, only API definition files are allowed.`,
    );
  });

  test('Effect worker runtime entry validates invalid edge modules at dispatcher creation', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-worker-wrapper-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'index.ts');
      const source = `export default { api: {}, layer: {} };`;
      await writeFile(entryFile, source);

      const runtimeModule = await buildEffectWorkerRuntimeModule({
        apiDir,
        appDir,
        entryFile,
        prefix: '/catalog-api',
        source,
      });

      expect(typeof runtimeModule.__modern_create_effect_bff_dispatcher).toBe(
        'function',
      );
      await expect(
        runtimeModule.__modern_create_effect_bff_dispatcher({
          prefix: '/catalog-api',
        }),
      ).rejects.toThrow('[BFF][Effect] Invalid Effect edge module');
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('Effect worker runtime source query transpiles the API without recursing into the wrapper', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-worker-source-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'index.ts');
      const source = `export const marker: string = 'raw-runtime-source';`;
      await writeFile(entryFile, source);

      const code = await runApiLoader({
        options: {
          apiDir,
          appDir,
          bffRuntimeFramework: 'effect',
          effectEntry: entryFile,
          existLambda: false,
          lambdaDir: path.join(apiDir, 'lambda'),
          port: 8080,
          prefix: '/catalog-api',
          target: 'web',
        },
        resourcePath: entryFile,
        resourceQuery: '?modern-bff-runtime-source',
        source,
      });

      const outputFile = path.join(appDir, 'raw-runtime-source.mjs');
      const { build } = await import('esbuild');
      await build({
        bundle: true,
        format: 'esm',
        platform: 'node',
        stdin: {
          contents: code,
          resolveDir: apiDir,
          sourcefile: entryFile,
        },
        outfile: outputFile,
      });
      const runtimeModule = await import(pathToFileURL(outputFile).href);
      expect(runtimeModule.marker).toBe('raw-runtime-source');
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('Effect worker dispatcher executes defineEffectBff with mounted prefix and edge env', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-worker-define-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'index.ts');
      const source = `
import {
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
  useEffectContext,
} from '@modern-js/plugin-bff/effect-edge';

const api = HttpApi.make('WorkerDefineApi').add(
  HttpApiGroup.make('status').add(
    HttpApiEndpoint.get('readiness', '/readiness', {
      success: Schema.Struct({
        env: Schema.String,
        originalPath: Schema.String,
        routePath: Schema.String,
      }),
    }),
  ),
);
const statusLayer = HttpApiBuilder.group(api, 'status', handlers =>
  handlers.handle('readiness', () =>
    Effect.sync(() => {
      const context = useEffectContext();
      return {
        env: String(context.env.RUNTIME),
        originalPath: context.path,
        routePath: context.operationContext.routePath,
      };
    }),
  ),
);

export default defineEffectBff({
  api,
  layer: HttpApiBuilder.layer(api).pipe(Layer.provide(statusLayer)),
});
`;
      await writeFile(entryFile, source);

      const runtime = await buildEffectWorkerRuntimeModule({
        apiDir,
        appDir,
        entryFile,
        prefix: '/catalog-api',
        source,
      });
      const dispatcher = await runtime.__modern_create_effect_bff_dispatcher({
        prefix: '/catalog-api',
      });

      try {
        const response = await dispatcher.dispatch(
          new Request('https://example.com/catalog-api/readiness'),
          { env: { RUNTIME: 'workerd' } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          env: 'workerd',
          originalPath: '/catalog-api/readiness',
          routePath: '/readiness',
        });
      } finally {
        await dispatcher.dispose();
      }
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('Effect worker dispatcher executes raw api and layer module exports', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-worker-raw-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'index.ts');
      const source = `
import {
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
  useEffectContext,
} from '@modern-js/plugin-bff/effect-edge';

export const api = HttpApi.make('WorkerRawApi').add(
  HttpApiGroup.make('status').add(
    HttpApiEndpoint.get('readiness', '/readiness', {
      success: Schema.Struct({
        env: Schema.String,
        originalPath: Schema.String,
        routePath: Schema.String,
      }),
    }),
  ),
);
const statusLayer = HttpApiBuilder.group(api, 'status', handlers =>
  handlers.handle('readiness', () =>
    Effect.sync(() => {
      const context = useEffectContext();
      return {
        env: String(context.env.RUNTIME),
        originalPath: context.path,
        routePath: context.operationContext.routePath,
      };
    }),
  ),
);
export const layer = HttpApiBuilder.layer(api).pipe(
  Layer.provide(statusLayer),
);
`;
      await writeFile(entryFile, source);

      const runtime = await buildEffectWorkerRuntimeModule({
        apiDir,
        appDir,
        entryFile,
        prefix: '/inventory-api',
        source,
      });
      const dispatcher = await runtime.__modern_create_effect_bff_dispatcher({
        prefix: '/inventory-api',
      });

      try {
        const response = await dispatcher.dispatch(
          new Request('https://example.com/inventory-api/readiness'),
          { env: { RUNTIME: 'raw-workerd' } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          env: 'raw-workerd',
          originalPath: '/inventory-api/readiness',
          routePath: '/readiness',
        });
      } finally {
        await dispatcher.dispose();
      }
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('Effect worker dispatcher disposes its bundled handler', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-worker-dispose-'),
    );
    const disposeMarker = Symbol.for(
      `modernjs.plugin-bff.test.dispose.${path.basename(appDir)}`,
    );
    const testGlobal = globalThis as typeof globalThis & {
      [disposeMarker]?: number;
    };
    testGlobal[disposeMarker] = 0;

    try {
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'index.ts');
      const source = `
import { useEffectContext } from '@modern-js/plugin-bff/effect-edge';

const disposeMarker = Symbol.for(${JSON.stringify(disposeMarker.description)});
export const createHandler = () => ({
  handler: request => {
    const context = useEffectContext();
    return Response.json({
      env: String(context.env.RUNTIME),
      requestPath: new URL(request.url).pathname,
    });
  },
  dispose: async () => {
    globalThis[disposeMarker] = Number(globalThis[disposeMarker] || 0) + 1;
  },
});
Object.defineProperty(
  createHandler,
  Symbol.for('modernjs.effect.validatorAware'),
  { value: true },
);
`;
      await writeFile(entryFile, source);

      const runtime = await buildEffectWorkerRuntimeModule({
        apiDir,
        appDir,
        entryFile,
        prefix: '/checkout-api',
        source,
      });
      const dispatcher = await runtime.__modern_create_effect_bff_dispatcher({
        prefix: '/checkout-api',
      });
      const response = await dispatcher.dispatch(
        new Request('https://example.com/checkout-api/cart'),
        { env: { RUNTIME: 'dispose-workerd' } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        env: 'dispose-workerd',
        requestPath: '/cart',
      });
      expect(testGlobal[disposeMarker]).toBe(0);

      await dispatcher.dispose();

      expect(testGlobal[disposeMarker]).toBe(1);
    } finally {
      delete testGlobal[disposeMarker];
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

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

  test('keeps workspace-owned transitive dependencies executable after relocating the entry', async () => {
    const fixtureDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-workspace-dependency-'),
    );
    const appDir = path.join(fixtureDir, 'app');
    const workspacePackageDir = path.join(fixtureDir, 'workspace-package');

    try {
      await writeEmptyPathsTsconfig(appDir);
      await writeFile(
        path.join(workspacePackageDir, 'package.json'),
        JSON.stringify({
          name: 'workspace-package',
          type: 'module',
          exports: './index.js',
        }),
      );
      await writeFile(
        path.join(workspacePackageDir, 'index.js'),
        `import { suffix } from 'workspace-transitive-dependency';
export const message = \`workspace-\${suffix}\`;`,
      );
      await writeFile(
        path.join(
          workspacePackageDir,
          'node_modules',
          'workspace-transitive-dependency',
          'package.json',
        ),
        JSON.stringify({
          name: 'workspace-transitive-dependency',
          type: 'module',
          exports: './index.js',
        }),
      );
      await writeFile(
        path.join(
          workspacePackageDir,
          'node_modules',
          'workspace-transitive-dependency',
          'index.js',
        ),
        `export const suffix = 'dependency';`,
      );

      const workspaceLink = path.join(
        appDir,
        'node_modules',
        'workspace-package',
      );
      await fs.promises.mkdir(path.dirname(workspaceLink), { recursive: true });
      await fs.promises.symlink(
        workspacePackageDir,
        workspaceLink,
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const entryFile = path.join(appDir, 'api', 'index.ts');
      await writeFile(
        entryFile,
        `export { message } from 'workspace-package';`,
      );

      const loaded = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryFile,
      })) as { message: string };

      expect(loaded.message).toBe('workspace-dependency');
    } finally {
      await fs.promises.rm(fixtureDir, { recursive: true, force: true });
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

  test('preserves dependency registration rejections from generated client codegen', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-codegen-rejection-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, 'effect', 'index.ts');
      const dependencyFailure = new Error('dependency registration failed');
      await writeEmptyPathsTsconfig(appDir);
      await writeFile(entryFile, `export const api = null;`);

      const rejection = await generateEffectClient({
        appDir,
        apiDir,
        resourcePath: entryFile,
        prefix: '/api',
        port: 8080,
        onDependency: () => {
          throw dependencyFailure;
        },
      }).then(
        () => undefined,
        error => error,
      );

      expect(rejection).toBe(dependencyFailure);
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
