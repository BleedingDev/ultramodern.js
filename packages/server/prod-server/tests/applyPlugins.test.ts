import { createServerBase, type ServerPlugin } from '@modern-js/server-core';
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
