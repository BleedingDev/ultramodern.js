import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type CloudflareExecutionContext,
  type CloudflareWorkerRequestHandlerOptions,
  isCloudflareWorkerRequestHandlerOptions,
} from '@modern-js/app-tools-extensions/cloudflare/worker-options';

type Bindings = {
  token: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
};
type WorkerOptions = CloudflareWorkerRequestHandlerOptions<Bindings>;
type Worker = {
  fetch(
    request: Request,
    env?: Bindings,
    context?: CloudflareExecutionContext,
  ): Promise<Response>;
};
type Form = 'request-handler' | 'flight' | 'fetch-export';
const forms: Form[] = ['request-handler', 'flight', 'fetch-export'];
const route = {
  urlPath: '/',
  entryName: 'main',
  entryPath: 'html/main/index.html',
  isSSR: true,
  worker: 'worker/main.js',
};
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

function emittedWorker(module: Record<string, unknown>): Worker {
  const manifest = {
    routeSpec: { routes: [route] },
    resources: {
      routeManifest: 'routes-manifest.json',
      loadableStats: 'loadable-stats.json',
    },
    rendererIdentities: {
      main: {
        renderer: 'react',
        appId: 'worker-bindings-fixture',
        entryName: 'main',
        protocolVersion: 1,
        buildId: 'fixture-build',
      },
    },
  };
  const source = templateSource
    .replace('export const modernWorkerManifest', 'const modernWorkerManifest')
    .replace('export default {', 'const worker = {');
  return new Function(
    'p_workerManifest',
    'p_workerModuleLoaders',
    `${source}\nreturn worker;`,
  )(manifest, { [route.worker]: async () => module }) as Worker;
}

function bindings(token: string): Bindings {
  return {
    token,
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        return new Response(
          pathname.endsWith('.json')
            ? JSON.stringify({ token, routeAssets: {} })
            : `<html><head></head><body>${token}</body></html>`,
        );
      },
    },
  };
}

function executionContext() {
  const tasks: Promise<unknown>[] = [];
  let passThroughCalls = 0;
  const context: CloudflareExecutionContext = {
    waitUntil(promise) {
      expect(this).toBe(context);
      tasks.push(promise);
    },
    passThroughOnException() {
      expect(this).toBe(context);
      passThroughCalls += 1;
    },
  };
  return { context, tasks, passThroughCalls: () => passThroughCalls };
}

function request(token: string, form: Form, signal?: AbortSignal) {
  return new Request(`https://worker.example/?request=${token}`, {
    method: 'POST',
    headers: {
      cookie: `request=${token}`,
      'x-private-request': token,
      ...(form === 'flight' ? { 'x-rsc-tree': '1' } : {}),
    },
    body: `body:${token}`,
    signal,
  });
}

function moduleFor(
  form: Form,
  handler: (
    request: Request,
    options: WorkerOptions | undefined,
    env: Bindings | undefined,
    context: CloudflareExecutionContext | undefined,
  ) => Promise<Response>,
) {
  if (form === 'fetch-export') {
    return {
      default: {
        fetch: (
          request: Request,
          env?: Bindings,
          context?: CloudflareExecutionContext,
        ) => handler(request, undefined, env, context),
      },
    };
  }
  return {
    [form === 'flight' ? 'rscPayloadHandler' : 'requestHandler']: (
      request: Request,
      options: WorkerOptions,
    ) =>
      handler(
        request,
        options,
        options.platform.bindings,
        options.executionContext,
      ),
  };
}

it.each(
  forms,
)('isolates overlapping %s requests and retains native bindings across awaits', async form => {
  const fixtures = ['first', 'second'].map(token => ({
    token,
    env: bindings(token),
    ...executionContext(),
    request: request(token, form),
    entered: Promise.withResolvers<void>(),
    release: Promise.withResolvers<void>(),
  }));
  const received: WorkerOptions[] = [];
  const worker = emittedWorker(
    moduleFor(form, async (receivedRequest, options, env, context) => {
      const fixture = fixtures.find(item => item.request === receivedRequest);
      if (!fixture) throw new Error('Worker replaced the native Request');
      expect(env).toBe(fixture.env);
      expect(context).toBe(fixture.context);
      expect(receivedRequest.signal).toBe(fixture.request.signal);
      expect(receivedRequest.bodyUsed).toBe(false);
      if (options) {
        expect(isCloudflareWorkerRequestHandlerOptions(options)).toBe(true);
        received.push(options);
        expect(options.platform.kind).toBe('worker');
        expect(options.params).toEqual({});
        expect(options.config).toEqual({});
        expect(options.resource.entryName).toBe('main');
        expect(options.resource.routeManifest.token).toBe(fixture.token);
        expect(options.resource.loadableStats.token).toBe(fixture.token);
        if (form === 'flight')
          expect(options.resource).not.toHaveProperty('htmlTemplate');
        else expect(options.resource.htmlTemplate).toContain(fixture.token);
        options.loaderContext.set('private-request', fixture.token);
      }
      fixture.entered.resolve();
      await fixture.release.promise;
      expect(env).toBe(fixture.env);
      expect(context).toBe(fixture.context);
      if (options) {
        expect(options.platform.bindings).toBe(fixture.env);
        expect(options.executionContext).toBe(fixture.context);
        expect(options.loaderContext.get('private-request')).toBe(
          fixture.token,
        );
      }
      context?.waitUntil(Promise.resolve(fixture.token));
      context?.passThroughOnException();
      const headers = new Headers({
        'content-type': form === 'flight' ? 'text/x-component' : 'text/plain',
        'x-private-response':
          receivedRequest.headers.get('x-private-request') ?? '',
      });
      headers.append('set-cookie', `first=${fixture.token}; Path=/`);
      headers.append('set-cookie', `second=${fixture.token}; Path=/`);
      return new Response(await receivedRequest.text(), {
        status: 202,
        headers,
      });
    }),
  );
  const pending = fixtures.map(fixture =>
    worker.fetch(fixture.request, fixture.env, fixture.context),
  );
  await Promise.all(fixtures.map(fixture => fixture.entered.promise));
  fixtures[1].release.resolve();
  const second = await pending[1];
  fixtures[0].release.resolve();
  const first = await pending[0];
  for (const [index, response] of [first, second].entries()) {
    const fixture = fixtures[index];
    expect(response.status).toBe(202);
    expect(response.headers.get('x-private-response')).toBe(fixture.token);
    expect(response.headers.getSetCookie()).toEqual([
      `first=${fixture.token}; Path=/`,
      `second=${fixture.token}; Path=/`,
    ]);
    expect(await response.text()).toBe(`body:${fixture.token}`);
    await expect(Promise.all(fixture.tasks)).resolves.toEqual([fixture.token]);
    expect(fixture.passThroughCalls()).toBe(1);
  }
  if (form !== 'fetch-export') {
    expect(received[0]).not.toBe(received[1]);
    expect(received[0].platform).not.toBe(received[1].platform);
    expect(received[0].loaderContext).not.toBe(received[1].loaderContext);
    expect(received[0].locals).not.toBe(received[1].locals);
  }
});

it.each(
  forms,
)('keeps the %s producer unread until consumption and cleans up once on cancellation', async form => {
  let pulls = 0;
  const cleanupReasons: unknown[] = [];
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode('native shell'));
      },
      cancel(reason) {
        cleanupReasons.push(reason);
      },
    },
    { highWaterMark: 0 },
  );
  const worker = emittedWorker(
    moduleFor(
      form,
      async () =>
        new Response(body, {
          status: 202,
          statusText: 'Native pending response',
          headers: {
            'content-type':
              form === 'flight' ? 'text/x-component' : 'text/plain',
          },
        }),
    ),
  );
  const response = await worker.fetch(
    request('cancel', form),
    bindings('cancel'),
  );
  expect(response.body).toBe(body);
  expect(response.body?.locked).toBe(false);
  expect(pulls).toBe(0);
  expect(response.status).toBe(202);
  expect(response.statusText).toBe('Native pending response');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Native response body is absent');
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    'native shell',
  );
  expect(pulls).toBe(1);
  const reason = new Error('native consumer cancellation');
  await reader.cancel(reason);
  reader.releaseLock();
  await response.body?.cancel(reason);
  expect(cleanupReasons).toEqual([reason]);
  expect(pulls).toBe(1);
});

it.each(
  forms,
)('preserves the %s request abort during deferred work', async form => {
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  let cleanups = 0;
  const worker = emittedWorker(
    moduleFor(form, async receivedRequest => {
      const pending = Promise.withResolvers<Response>();
      const abort = () => pending.reject(receivedRequest.signal.reason);
      receivedRequest.signal.addEventListener('abort', abort, { once: true });
      entered.resolve();
      try {
        return await pending.promise;
      } finally {
        receivedRequest.signal.removeEventListener('abort', abort);
        cleanups += 1;
      }
    }),
  );
  const pending = worker.fetch(
    request('abort', form, controller.signal),
    bindings('abort'),
  );
  await entered.promise;
  const reason = new Error('abort deferred producer');
  const rejected = expect(pending).rejects.toBe(reason);
  controller.abort(reason);
  await rejected;
  expect(cleanups).toBe(1);
});

it.each([
  'request-handler',
  'flight',
] as const)('keeps omitted %s bindings and context absent', async form => {
  const worker = emittedWorker(
    moduleFor(form, async (_request, options) => {
      expect(options?.platform.kind).toBe('worker');
      expect(options?.platform).toHaveProperty('bindings', undefined);
      expect(options).toHaveProperty('executionContext', undefined);
      if (!options) throw new Error('Manifest options are absent');
      expect(isCloudflareWorkerRequestHandlerOptions(options)).toBe(true);
      return new Response('direct invocation');
    }),
  );
  const response = await worker.fetch(request('direct', form));
  expect(await response.text()).toBe('direct invocation');
});

it('rejects missing or malformed worker additions when narrowing native options', async () => {
  const worker = emittedWorker(
    moduleFor('request-handler', async (_request, options) => {
      if (!options) throw new Error('Manifest options are absent');
      const { platform: _platform, ...missingPlatform } = options;
      const { executionContext: _context, ...missingContext } = options;
      expect(isCloudflareWorkerRequestHandlerOptions(missingPlatform)).toBe(
        false,
      );
      expect(isCloudflareWorkerRequestHandlerOptions(missingContext)).toBe(
        false,
      );
      for (const platform of [
        null,
        'worker',
        { kind: 'node', bindings: {} },
        { kind: 'worker' },
        { kind: 'worker', bindings: null },
        { kind: 'worker', bindings: [] },
        { kind: 'worker', bindings: 'native' },
      ]) {
        const malformed = { ...options, platform };
        expect(isCloudflareWorkerRequestHandlerOptions(malformed)).toBe(false);
      }
      for (const executionContext of [
        null,
        'context',
        {},
        { waitUntil() {} },
        { waitUntil: true, passThroughOnException() {} },
        { waitUntil() {}, passThroughOnException: true },
      ]) {
        const malformed = { ...options, executionContext };
        expect(isCloudflareWorkerRequestHandlerOptions(malformed)).toBe(false);
      }
      return new Response('narrowed native options');
    }),
  );
  expect(
    (
      await worker.fetch(
        request('narrow', 'request-handler'),
        bindings('narrow'),
      )
    ).status,
  ).toBe(200);
});
