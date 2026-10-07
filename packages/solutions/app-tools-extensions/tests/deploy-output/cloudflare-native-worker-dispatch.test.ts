import fs from 'node:fs/promises';
import path from 'node:path';
import { dispatchNativeWorkerRequest } from '../../../../runtime/renderer-core/src/server/worker';

type Renderer = 'react' | 'solid' | 'octane';
type WorkerModule = Record<string, unknown>;
type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};
type Worker = {
  fetch(
    request: Request,
    env?: Record<string, unknown>,
    ctx?: ExecutionContext,
  ): Promise<Response>;
};

const route = {
  urlPath: '/',
  entryName: 'main',
  entryPath: 'html/main/index.html',
  isSSR: true,
  worker: 'worker/main.js',
  workerExists: true,
};
const identity = (renderer: Renderer) => ({
  renderer,
  appId: 'native-worker-fixture',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'fixture-build',
});
const nativeResources = (renderer: Renderer) => ({
  schema: 'ultramodern-native-worker-resources',
  version: 1,
  renderer,
  entries: {
    main: {
      assets: [{ kind: 'script', href: '/static/js/main.js' }],
      nativeManifest: { compiler: 'fixture' },
      serverConfig: { ssr: 'stream' },
    },
  },
});

let templateSource: string;
beforeAll(async () => {
  const directory = path.resolve(__dirname, '../../src/templates');
  const filenames = (await fs.readdir(directory))
    .filter(filename => /^cloudflare-entry\.\d{3}-.*\.mjs$/.test(filename))
    .sort();
  templateSource = (
    await Promise.all(
      filenames.map(filename =>
        fs.readFile(path.join(directory, filename), 'utf8'),
      ),
    )
  ).join('\n');
});

function emittedWorker(
  manifest: Record<string, unknown>,
  loaders: Record<string, () => Promise<WorkerModule>>,
): Worker {
  const source = templateSource
    .replace('export const modernWorkerManifest', 'const modernWorkerManifest')
    .replace('export default {', 'const worker = {');
  return new Function(
    'p_workerManifest',
    'p_workerModuleLoaders',
    `${source}\nreturn worker;`,
  )(
    {
      routeSpec: { routes: [route] },
      resources: {
        routeManifest: 'routes-manifest.json',
        loadableStats: 'loadable-stats.json',
      },
      // A native build's manifest names its native-document renderer.
      renderer: {
        name: Object.values(
          manifest.rendererIdentities as Record<string, { renderer: string }>,
        )[0].renderer,
        nativeDocuments: true,
        rsc: false,
      },
      ...manifest,
    },
    loaders,
  ) as Worker;
}

function assetBinding(served: string[] = []) {
  return {
    async fetch(request: Request) {
      const pathname = new URL(request.url).pathname;
      served.push(pathname);
      return new Response(
        pathname.endsWith('.json') ? '{}' : `asset:${pathname}`,
        { headers: { 'content-type': 'text/plain' } },
      );
    },
  };
}

function executionContext() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    context: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
      passThroughOnException() {},
    },
  };
}

/** A native bundle: the same handler the Node host loads, plus the dispatcher. */
function nativeBundle(
  renderer: Renderer,
  handler: (request: Request, context: any) => Response | Promise<Response>,
) {
  return {
    rendererIdentity: identity(renderer),
    nativeRequestHandler: handler,
    nativeCSRRequestHandler: handler,
    dispatchNativeWorkerRequest,
  };
}

describe.each(['solid', 'octane'] as const)(
  '%s native worker dispatch',
  renderer => {
    it('streams the native document with env and ctx as the worker platform', async () => {
      const { pending, context } = executionContext();
      const env = { ASSETS: assetBinding(), DB: { name: 'd1' } };
      let observed: any;
      let release!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      const worker = emittedWorker(
        {
          rendererIdentities: { main: identity(renderer) },
          nativeRenderer: nativeResources(renderer),
        },
        {
          [route.worker]: async () =>
            nativeBundle(renderer, (request, nativeContext) => {
              observed = {
                url: request.url,
                platform: nativeContext.session.platform,
                assets: nativeContext.assets,
                nativeManifest: nativeContext.nativeManifest,
                serverConfig: nativeContext.serverConfig,
              };
              const encoder = new TextEncoder();
              return new Response(
                new ReadableStream({
                  async start(controller) {
                    controller.enqueue(encoder.encode('<html><body>shell'));
                    await held;
                    controller.enqueue(encoder.encode(' late</body></html>'));
                    controller.close();
                  },
                }),
                { headers: { 'content-type': 'text/html; charset=utf-8' } },
              );
            }),
        },
      );
      const response = await worker.fetch(
        new Request('https://example.com/items/1?__loader=x'),
        env,
        context,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/html; charset=utf-8',
      );
      expect(
        JSON.parse(response.headers.get('x-ultramodern-renderer-identity')!),
      ).toEqual(identity(renderer));
      expect(observed.platform.kind).toBe('worker');
      expect(observed.platform.bindings).toBe(env);
      expect(observed.assets).toEqual([
        { kind: 'script', href: '/static/js/main.js' },
      ]);
      expect(observed.nativeManifest).toEqual({ compiler: 'fixture' });
      expect(observed.serverConfig).toEqual({ ssr: 'stream', forceCSR: false });
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe('<html><body>shell');
      release();
      let rest = '';
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        rest += new TextDecoder().decode(part.value);
      }
      expect(rest).toBe(' late</body></html>');
      expect(pending).toHaveLength(1);
      await expect(pending[0]).resolves.toMatchObject({ state: 'completed' });
    });

    it.each(['x-rsc-tree', 'x-rsc-action'])(
      'rejects %s before importing the native bundle',
      async header => {
        let evaluations = 0;
        const worker = emittedWorker(
          {
            rendererIdentities: { main: identity(renderer) },
            nativeRenderer: nativeResources(renderer),
          },
          {
            [route.worker]: async () => {
              evaluations += 1;
              return {};
            },
          },
        );
        const response = await worker.fetch(
          new Request('https://example.com/', { headers: { [header]: '1' } }),
          { ASSETS: assetBinding() },
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          code: 'unsupported-renderer-capability',
          capability: 'rsc',
        });
        expect(evaluations).toBe(0);
      },
    );

    it('serves static assets without the native bundle', async () => {
      const served: string[] = [];
      const worker = emittedWorker(
        {
          rendererIdentities: { main: identity(renderer) },
          nativeRenderer: nativeResources(renderer),
        },
        {
          [route.worker]: async () => {
            throw new Error('asset requests must not import the SSR bundle');
          },
        },
      );
      const response = await worker.fetch(
        new Request('https://example.com/static/js/main.js'),
        { ASSETS: assetBinding(served) },
      );
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('asset:/static/js/main.js');
      expect(served).toEqual(['/static/js/main.js']);
    });

    it('turns a pre-commit native failure into a controlled 500', async () => {
      const errors: unknown[] = [];
      const originalError = console.error;
      console.error = (error: unknown) => errors.push(error);
      try {
        const worker = emittedWorker(
          {
            rendererIdentities: { main: identity(renderer) },
            nativeRenderer: nativeResources(renderer),
          },
          {
            [route.worker]: async () =>
              nativeBundle(renderer, () => {
                throw new Error('native handler failed');
              }),
          },
        );
        const response = await worker.fetch(
          new Request('https://example.com/'),
          {
            ASSETS: assetBinding(),
          },
        );
        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          code: 'native-render-failed',
          entryName: 'main',
        });
        expect(String(errors[0])).toContain('native handler failed');
      } finally {
        console.error = originalError;
      }
    });

    it('rejects a native route whose build has no worker resources', async () => {
      const worker = emittedWorker(
        { rendererIdentities: { main: identity(renderer) } },
        {
          [route.worker]: async () => {
            throw new Error('missing resources must not import the bundle');
          },
        },
      );
      const response = await worker.fetch(new Request('https://example.com/'), {
        ASSETS: assetBinding(),
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        code: 'missing-native-renderer-resources',
        entryName: 'main',
      });
    });
  },
);
