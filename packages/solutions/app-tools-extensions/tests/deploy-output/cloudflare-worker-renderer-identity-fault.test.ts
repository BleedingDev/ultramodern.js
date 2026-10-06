import fs from 'node:fs/promises';
import path from 'node:path';

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

it('returns a controlled 500 when a worker route has no renderer identity', async () => {
  let cancelled = false;
  const worker = emittedWorker(
    {
      rendererIdentities: {
        other: { ...identity('react'), entryName: 'other' },
      },
    },
    {
      [route.worker]: async () => ({
        fetch: () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
          ),
      }),
    },
  );
  const response = await worker.fetch(new Request('https://example.com/'), {
    ASSETS: assetBinding(),
  });
  expect(response.status).toBe(500);
  expect(response.headers.get('cache-control')).toBe('no-store');
  await expect(response.json()).resolves.toEqual({
    code: 'missing-renderer-identity',
    entryName: 'main',
  });
  expect(cancelled).toBe(true);
});
