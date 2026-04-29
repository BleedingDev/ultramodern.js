import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { EffectAdapter } from '../src/runtime/effect/adapter';
import clientGenerator, {
  type APILoaderOptions,
} from '../src/utils/clientGenerator';
import runtimeGenerator from '../src/utils/runtimeGenerator';

describe('plugin-bff regressions', () => {
  test('effect adapter strips API prefix in enableHandleWeb mode', async () => {
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'effect',
          middlewares,
        };
      },
    } as unknown;

    const adapter = new EffectAdapter(api as ServerPluginAPI);
    const adapterState = adapter as unknown as {
      reloadHandler: () => Promise<void>;
      reloadLegacyApiRoutes: () => Promise<void>;
      handler: (request: Request) => Promise<Response>;
    };
    let seenPath = '';

    adapterState.reloadHandler = async () => {
      adapterState.handler = async (request: Request) => {
        seenPath = new URL(request.url).pathname;
        return new Response('ok');
      };
    };
    adapterState.reloadLegacyApiRoutes = async () => {};

    await adapter.registerMiddleware({
      prefix: '/api',
      enableHandleWeb: true,
    });

    const middleware = middlewares[0];
    expect(middleware).toBeDefined();

    const context = {
      req: {
        raw: new Request('http://localhost/api/effect/hello'),
        path: '/api/effect/hello',
        method: 'GET',
      },
      env: {},
    };

    const response = (await middleware.handler(
      context as unknown,
      async () => {},
    )) as Response | undefined;

    expect(seenPath).toBe('/effect/hello');
    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(200);
  });

  test('client generator skips lambda scan when existLambda is false', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-regression-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const lambdaDir = path.join(apiDir, 'lambda');
      await fs.promises.mkdir(apiDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'regression-app', version: '1.0.0' }, null, 2),
      );

      const options: APILoaderOptions = {
        prefix: '/api',
        appDir,
        apiDir,
        lambdaDir,
        existLambda: false,
        port: 8080,
        relativeDistPath: '.modern-js',
        relativeApiPath: './api',
        bffRuntimeFramework: 'effect',
      };

      await expect(clientGenerator(options)).resolves.toBeUndefined();
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('client generator marks generated client output as ESM', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-client-module-'),
    );
    const previousCwd = process.cwd();

    try {
      const apiDir = path.join(appDir, 'api');
      const effectDir = path.join(apiDir, 'effect');
      const lambdaDir = path.join(apiDir, 'lambda');
      await fs.promises.mkdir(effectDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'module-app', version: '1.0.0' }, null, 2),
      );
      await fs.promises.writeFile(
        path.join(effectDir, 'index.js'),
        `const {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} = require('@modern-js/plugin-bff/effect-client');

const api = HttpApi.make('ModuleApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('ping', '/effect/ping', {
      success: Schema.Struct({
        ok: Schema.Boolean,
      }),
    }),
  ),
);

module.exports = { api };
`,
      );

      process.chdir(appDir);
      await clientGenerator({
        prefix: '/api',
        appDir,
        apiDir,
        lambdaDir,
        existLambda: false,
        port: 8080,
        relativeDistPath: '.modern-js',
        relativeApiPath: './api',
        bffRuntimeFramework: 'effect',
      });

      const clientPackageJson = JSON.parse(
        await fs.promises.readFile(
          path.join(appDir, '.modern-js', 'client', 'package.json'),
          'utf8',
        ),
      );
      expect(clientPackageJson).toEqual({ type: 'module' });
      await expect(
        fs.promises.stat(
          path.join(appDir, '.modern-js', 'client', 'effect', 'index.js'),
        ),
      ).resolves.toBeDefined();
    } finally {
      process.chdir(previousCwd);
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('runtime generator exposes initProducerClient alias', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-runtime-'),
    );

    try {
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'runtime-app', version: '1.0.0' }, null, 2),
      );
      await runtimeGenerator({
        runtime: '@modern-js/plugin-bff/client',
        appDirectory: appDir,
        relativeDistPath: '.modern-js',
      });

      const runtimeCode = await fs.promises.readFile(
        path.join(appDir, '.modern-js', 'runtime', 'index.js'),
        'utf8',
      );
      const runtimeTypes = await fs.promises.readFile(
        path.join(appDir, '.modern-js', 'runtime', 'index.d.ts'),
        'utf8',
      );

      expect(runtimeCode).toContain('const initProducerClient = (options)');
      expect(runtimeCode).toContain('const configure = initProducerClient;');
      expect(runtimeCode).toMatch(/requestId:\s*['"]runtime-app['"]/);
      expect(runtimeTypes).toContain('initProducerClient');
      expect(runtimeTypes).toContain('typeof import("@modern-js/plugin-bff/client")');
      expect(runtimeTypes).toContain(
        'export declare const configure: typeof initProducerClient;',
      );
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('client generator fails fast on package export collisions', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-collision-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const lambdaDir = path.join(apiDir, 'lambda');
      await fs.promises.mkdir(apiDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify(
          {
            name: 'collision-app',
            version: '1.0.0',
            exports: {
              './api/*': {
                import: './custom/api/*.js',
                types: './custom/api/*.d.ts',
              },
            },
          },
          null,
          2,
        ),
      );

      const options: APILoaderOptions = {
        prefix: '/api',
        appDir,
        apiDir,
        lambdaDir,
        existLambda: false,
        port: 8080,
        relativeDistPath: '.modern-js',
        relativeApiPath: './api',
      };

      await expect(clientGenerator(options)).rejects.toThrow(
        /package\.json exports conflict/,
      );
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
