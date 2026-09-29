import fs from 'node:fs';
import path from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import {
  DEFAULT_COMPATIBILITY_DATE,
  REQUIRED_COMPATIBILITY_FLAGS,
} from '../src/cloudflare/constants';

const TEMPLATE_DIRECTORY = path.join(__dirname, '../src/templates');
const TEMPLATE_FRAGMENTS = fs
  .readdirSync(TEMPLATE_DIRECTORY)
  .filter(name => /^cloudflare-entry\.\d{3}-.+\.mjs$/u.test(name))
  .sort();

const manifest = {
  bff: {
    worker: 'worker/__modern_bff_effect.js',
    prefix: '/api',
    runtimeFramework: 'effect',
    dispatcherExport: '__modern_create_effect_bff_dispatcher',
    effect: {
      crossProjectPolicy: {
        enabled: false,
        requireEnvelope: false,
        requireOperationContext: false,
        requireOperationContextDetails: false,
        requireOperationSchemaHash: false,
        requireOperationVersion: false,
        allowUnknownOperations: true,
        expectedOperationContracts: {},
      },
    },
  },
  resources: {},
  routeSpec: { routes: [] },
};

// Each dispatcher counts itself, reports how many earlier dispatchers were disposed, and streams its
// body in two chunks so disposal has to wait for the whole body.
const bffWorker = `
let created = 0;
let disposed = 0;
let disposedBeforeBodyEnd = false;
export const __modern_create_effect_bff_dispatcher = async () => {
  const id = ++created;
  let bodyDone = false;
  return {
    dispatch: async () => {
      const disposedWhenDispatched = disposed;
      const encoder = new TextEncoder();
      // Several chunks, so a body nobody reads applies backpressure instead of fitting a buffer.
      const chunks = ['{"id":' + id, ',"disposedWhenDispatched":' + disposedWhenDispatched, ',"disposedBeforeBodyEnd":' + disposedBeforeBodyEnd + '}'];
      const body = new ReadableStream({
        async pull(controller) {
          await scheduler.wait(1);
          const chunk = chunks.shift();
          if (chunk === undefined) {
            bodyDone = true;
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(chunk));
        },
      }, { highWaterMark: 0 });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    },
    dispose: async () => {
      if (!bodyDone) disposedBeforeBodyEnd = true;
      disposed += 1;
    },
  };
};
`;

const entrySource = () =>
  TEMPLATE_FRAGMENTS.map(name =>
    fs.readFileSync(path.join(TEMPLATE_DIRECTORY, name), 'utf8'),
  )
    .join('')
    .replace('p_workerManifest', JSON.stringify(manifest))
    .replace(
      'p_workerModuleLoaders',
      `{ ${JSON.stringify(manifest.bff.worker)}: () => import(${JSON.stringify(`../${manifest.bff.worker}`)}) }`,
    );

const createWorker = () =>
  new Miniflare(
    convertV4MiniflareOptions({
      compatibilityDate: DEFAULT_COMPATIBILITY_DATE,
      compatibilityFlags: [...REQUIRED_COMPATIBILITY_FLAGS],
      modules: [
        {
          type: 'ESModule',
          path: '/output/server/index.mjs',
          contents: entrySource(),
        },
        {
          type: 'ESModule',
          path: '/output/worker/__modern_bff_effect.js',
          contents: bffWorker,
        },
      ],
      modulesRoot: '/output',
    }),
  );

describe('Cloudflare Effect BFF request scope', () => {
  it('builds a dispatcher per request and disposes it after the response body', async () => {
    const worker = createWorker();
    try {
      const first = await (
        await worker.dispatchFetch('https://app.invalid/api/ping')
      ).json();
      const second = await (
        await worker.dispatchFetch('https://app.invalid/api/ping')
      ).json();

      expect(first).toEqual({
        id: 1,
        disposedWhenDispatched: 0,
        disposedBeforeBodyEnd: false,
      });
      // The first request's dispatcher was disposed after its body, never reused.
      expect(second).toEqual({
        id: 2,
        disposedWhenDispatched: 1,
        disposedBeforeBodyEnd: false,
      });
    } finally {
      await worker.dispose();
    }
  }, 120_000);

  it('releases the dispatcher of a HEAD request whose body is never sent', async () => {
    const worker = createWorker();
    try {
      const head = await worker.dispatchFetch('https://app.invalid/api/ping', {
        method: 'HEAD',
      });
      expect(await head.text()).toBe('');
      // Disposal runs through waitUntil after the discarded body is cancelled.
      let next: { id: number; disposedWhenDispatched: number } | undefined;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        next = await (
          await worker.dispatchFetch('https://app.invalid/api/ping')
        ).json();
        if (next.disposedWhenDispatched >= 1) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(next?.disposedWhenDispatched).toBeGreaterThanOrEqual(1);
    } finally {
      await worker.dispose();
    }
  }, 120_000);
});
