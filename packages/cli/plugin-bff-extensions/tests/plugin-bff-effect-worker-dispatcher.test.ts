import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import apiLoader, {
  type EffectBffLoaderOptions as APILoaderOptions,
} from '../src/effect-source-loader/rspack-loader';

type WorkerRuntimeModule = {
  __modern_create_effect_bff_dispatcher: (options: {
    prefix?: string;
  }) => Promise<{
    dispatch: (
      request: Request,
      options?: { env?: Record<string, unknown> },
    ) => Promise<Response>;
    dispose: () => Promise<void>;
  }>;
};

const effectRuntimeRoot = path.resolve(__dirname, '../../../server/bff-effect');
const require = createRequire(path.resolve(__dirname, '../package.json'));

const writeFile = async (filename: string, source: string) => {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true });
  await fs.promises.writeFile(filename, source);
};

const runApiLoader = async (options: APILoaderOptions, source: string) => {
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
      resourcePath: options.effectEntry,
      resourceQuery: '?modern-bff-runtime',
    };
    void apiLoader.call(context as never, source);
  });

  if (callbackError) {
    throw callbackError;
  }
  return String(callbackCode);
};

// Links @modern-js/bff-effect into the temp app, runs the real rspack loader to
// generate the worker wrapper, bundles it with esbuild and imports the result.
const buildEffectWorkerRuntimeModule = async (
  appDir: string,
  entryFile: string,
  prefix: string,
  source: string,
) => {
  const linked = path.join(appDir, 'node_modules/@modern-js/bff-effect');
  await fs.promises.mkdir(path.dirname(linked), { recursive: true });
  await fs.promises.symlink(
    path.dirname(require.resolve('@modern-js/bff-effect/package.json')),
    linked,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const wrapperFile = path.join(appDir, 'effect-worker-wrapper.mjs');
  const outputFile = path.join(appDir, 'effect-worker-runtime.mjs');
  await writeFile(
    wrapperFile,
    await runApiLoader(
      {
        apiDir: path.dirname(entryFile),
        appDir,
        effectEntry: entryFile,
        port: 8080,
        prefix,
        target: 'web',
      },
      source,
    ),
  );

  const { build } = await import('esbuild');
  await build({
    alias: {
      '@modern-js/bff-effect/effect-edge': path.resolve(
        effectRuntimeRoot,
        'src/effect/edge.ts',
      ),
      '@modern-js/server-runtime-extensions/backend-federation-security':
        path.resolve(
          __dirname,
          '../../../server/runtime-extensions/src/backend-federation-security/index.ts',
        ),
    },
    bundle: true,
    entryPoints: [wrapperFile],
    format: 'esm',
    outfile: outputFile,
    platform: 'node',
    target: 'node26.10',
  });
  return import(
    `${pathToFileURL(outputFile).href}?t=${Date.now()}`
  ) as Promise<WorkerRuntimeModule>;
};

describe('Effect source graph loading — worker dispatcher', () => {
  test('Effect worker dispatcher executes defineEffectBff with mounted prefix and edge env', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-worker-define-'),
    );

    try {
      const entryFile = path.join(appDir, 'api', 'index.ts');
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
} from '@modern-js/bff-effect/effect-edge';

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

      const runtime = await buildEffectWorkerRuntimeModule(
        appDir,
        entryFile,
        '/catalog-api',
        source,
      );
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
});
