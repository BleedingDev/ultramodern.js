import {
  createServerBase,
  type ServerMiddleware,
  type ServerPlugin,
} from '@modern-js/server-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyPlugins } from '../src/apply';
import type { ProdServerOptions } from '../src/types';

describe('native error response extension', () => {
  let directory: string;
  let server: ReturnType<typeof createServerBase> | undefined;

  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'native-error-response-'),
    );
  });

  afterEach(async () => {
    await server?.dispose();
    server = undefined;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const initialize = async (
    plugins: ServerPlugin[] = [],
    onError?: NonNullable<ProdServerOptions['serverConfig']>['onError'],
  ) => {
    const options: ProdServerOptions = {
      pwd: directory,
      serverConfigPath: path.join(directory, 'modern.server.js'),
      appContext: {
        appDirectory: directory,
        apiDirectory: '',
        lambdaDirectory: '',
      },
      config: {
        html: {},
        output: {},
        source: {},
        tools: {},
        server: { logger: false },
        bff: { prefix: ['/api', '/rpc'] },
        dev: {},
        security: {},
      },
      plugins,
      serverConfig: {
        onError,
        middlewares: [
          {
            name: 'throw-request-error',
            order: 'pre',
            handler: () => {
              throw Object.assign(new Error('private database detail'), {
                status: 503,
                retryAfter: 90,
              });
            },
          },
        ],
      },
    };
    server = createServerBase(options);
    await applyPlugins(server, options);
    await server.init();
    return server;
  };

  test('redacts unhandled API errors in the native JSON shape', async () => {
    const instance = await initialize();
    for (const url of ['/api/failure', '/rpc/failure']) {
      const response = await instance.request(url, {}, {});
      expect(response.status).toBe(500);
      expect(response.headers.get('Retry-After')).toBeNull();
      await expect(response.json()).resolves.toEqual({
        message: '[BFF] Internal Server Error',
      });
    }
  });

  test('keeps native HTML for unhandled non-API errors', async () => {
    const instance = await initialize();
    const response = await instance.request('/page', {}, {});
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Internal Server Error');
    expect(html).not.toContain('private database detail');
  });

  test('runs the user handler before plugin response handlers', async () => {
    const calls: string[] = [];
    const instance = await initialize(
      [
        {
          name: 'response-hook',
          setup(api) {
            api.handleError(async input => {
              calls.push('plugin');
              return { ...input, response: new Response('plugin') };
            });
          },
        },
      ],
      () => {
        calls.push('user');
        return new Response('user response', { status: 418 });
      },
    );
    const response = await instance.request('/api/failure', {}, {});
    expect(response.status).toBe(418);
    expect(await response.text()).toBe('user response');
    expect(calls).toEqual(['user']);
  });

  test.each(['declines', 'throws'])(
    'runs plugins when the user handler %s',
    async outcome => {
      const calls: string[] = [];
      const instance = await initialize(
        [
          {
            name: 'delegating-hook',
            setup(api) {
              api.handleError(async (input, next) => {
                calls.push('delegate');
                next?.(input);
                return input;
              });
            },
          },
          {
            name: 'response-hook',
            setup(api) {
              api.handleError(async input => {
                calls.push('response');
                expect(input.error.message).toBe('private database detail');
                expect(input.context.req.path).toBe('/api/failure');
                return {
                  ...input,
                  response: new Response('plugin response', { status: 422 }),
                };
              });
            },
          },
          {
            name: 'unreached-hook',
            setup(api) {
              api.handleError(async input => {
                calls.push('unreached');
                return input;
              });
            },
          },
        ],
        () => {
          calls.push('user');
          if (outcome === 'throws') throw new Error('handler failure');
        },
      );
      const response = await instance.request('/api/failure', {}, {});
      expect(response.status).toBe(422);
      expect(await response.text()).toBe('plugin response');
      expect(calls).toEqual(['user', 'delegate', 'response']);
    },
  );

  test('falls back safely when a response plugin throws', async () => {
    const instance = await initialize([
      {
        name: 'broken-hook',
        setup(api) {
          api.handleError(async () => {
            throw new Error('plugin secret');
          });
        },
      },
    ]);
    const response = await instance.request('/api/failure', {}, {});
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: '[BFF] Internal Server Error',
    });
  });
});

describe('native RSC manifest enablement', () => {
  type RscConfig = NonNullable<ProdServerOptions['config']['server']>['rsc'];
  const cases: {
    name: string;
    application?: RscConfig;
    runtime?: RscConfig;
    enabled: boolean;
  }[] = [
    { name: 'omitted options', enabled: false },
    { name: 'native boolean', application: true, enabled: true },
    {
      name: 'application environment mapping',
      application: { environments: { server: 'workerSSR', client: 'client' } },
      runtime: false,
      enabled: true,
    },
    {
      name: 'runtime environment mapping fallback',
      runtime: { environments: { server: 'server', client: 'client' } },
      enabled: true,
    },
    {
      name: 'explicit application false over runtime mapping',
      application: false,
      runtime: { environments: { server: 'server', client: 'client' } },
      enabled: false,
    },
  ];

  test.each(cases)('loads native manifests for $name', async input => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'native-rsc-enablement-'),
    );
    let server: ReturnType<typeof createServerBase> | undefined;
    try {
      const manifests = {
        server: { marker: 'server' },
        client: { marker: 'client' },
        ssr: { marker: 'ssr' },
      };
      fs.mkdirSync(path.join(directory, 'bundles'));
      fs.writeFileSync(
        path.join(directory, 'bundles/react-server-manifest.json'),
        JSON.stringify(manifests.server),
      );
      fs.writeFileSync(
        path.join(directory, 'react-client-manifest.json'),
        JSON.stringify(manifests.client),
      );
      fs.writeFileSync(
        path.join(directory, 'react-ssr-manifest.json'),
        JSON.stringify(manifests.ssr),
      );
      const observeManifests: Exclude<
        ServerMiddleware['handler'],
        unknown[]
      > = async context =>
        context.json({
          server: context.get('rscServerManifest') ?? null,
          client: context.get('rscClientManifest') ?? null,
          ssr: context.get('rscSSRManifest') ?? null,
        });
      const options: ProdServerOptions = {
        pwd: directory,
        serverConfigPath: path.join(directory, 'modern.server.js'),
        appContext: {
          appDirectory: directory,
          apiDirectory: '',
          lambdaDirectory: '',
        },
        config: {
          html: {},
          output: {},
          source: {},
          tools: {},
          server: {
            logger: false,
            ...(input.application === undefined
              ? {}
              : { rsc: input.application }),
          },
          bff: {},
          dev: {},
          security: {},
        },
        serverConfig: {
          server: input.runtime === undefined ? {} : { rsc: input.runtime },
        },
        plugins: [
          {
            name: 'observe-native-rsc-manifests',
            setup(api) {
              api.onPrepare(() => {
                api.getServerContext().middlewares.push({
                  name: 'observe-native-rsc-manifests',
                  order: 'post',
                  handler: observeManifests,
                });
              });
            },
          },
        ],
      };
      server = createServerBase(options);
      await applyPlugins(server, options);
      await server.init();
      const response = await server.request('/native-manifests', {}, {});
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        input.enabled ? manifests : { server: null, client: null, ssr: null },
      );
    } finally {
      try {
        await server?.dispose();
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });
});
