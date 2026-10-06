import type { RendererIdentity } from '../../src/identity';
import {
  dispatchNativeNodeRequest,
  dispatchNativeWorkerRequest,
  type NativeRequestContext,
  type NativeWorkerEntryResources,
} from '../../src/server';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'worker-dispatch-test',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'build-a',
};
const resources: NativeWorkerEntryResources = {
  assets: [{ kind: 'script', href: '/static/js/main.js' }],
  nativeManifest: { modules: {} },
  serverConfig: { ssr: 'stream' },
};

function documentHandler(seen: NativeRequestContext[]) {
  return (_request: Request, context: NativeRequestContext) => {
    seen.push(context);
    context.session.resolveResponse({
      kind: 'document',
      status: 200,
      headers: [['content-type', 'text/html; charset=utf-8']],
      cache: { mode: 'no-store' },
    });
    context.session.startRendering();
    return context.session.respond(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<main>worker</main>'));
          controller.close();
        },
      }),
    );
  };
}

describe('native worker Fetch dispatch', () => {
  it('binds env as the worker platform and keeps cleanup alive through waitUntil', async () => {
    const seen: NativeRequestContext[] = [];
    const env = { DB: { binding: 'd1' } };
    const pending: Promise<unknown>[] = [];
    const response = await dispatchNativeWorkerRequest(
      new Request('https://worker.test/items/1'),
      {
        identity,
        bundle: {
          rendererIdentity: identity,
          nativeRequestHandler: documentHandler(seen),
        },
        resources,
        bindings: env,
        executionContext: { waitUntil: promise => pending.push(promise) },
      },
    );
    expect(await response.text()).toBe('<main>worker</main>');
    expect(seen[0]!.session.platform).toEqual({
      kind: 'worker',
      bindings: env,
    });
    expect(seen[0]!.session.platform.bindings).toBe(env);
    expect(seen[0]!.assets).toEqual(resources.assets);
    expect(seen[0]!.nativeManifest).toBe(resources.nativeManifest);
    expect(seen[0]!.serverConfig).toEqual({ ssr: 'stream', forceCSR: false });
    expect(pending).toHaveLength(1);
    await expect(pending[0]).resolves.toMatchObject({ state: 'completed' });
  });

  it('reads a default-exported manifest and rejects a conflicting bundle identity', async () => {
    const seen: NativeRequestContext[] = [];
    const ok = await dispatchNativeWorkerRequest(
      new Request('https://worker.test/'),
      {
        identity,
        bundle: {
          default: {
            rendererIdentity: identity,
            nativeRequestHandler: documentHandler(seen),
          },
        },
        resources,
        bindings: undefined,
      },
    );
    expect(ok.status).toBe(200);
    expect(seen[0]!.session.platform.bindings).toEqual({});
    await expect(
      dispatchNativeWorkerRequest(new Request('https://worker.test/'), {
        identity,
        bundle: {
          rendererIdentity: { ...identity, buildId: 'build-b' },
          nativeRequestHandler: documentHandler([]),
        },
        resources,
        bindings: {},
      }),
    ).rejects.toThrow('conflicts with the application build');
  });

  it.each([
    'x-rsc-tree',
    'x-rsc-action',
  ])('rejects %s before loading the bundle', async header => {
    const response = await dispatchNativeWorkerRequest(
      new Request('https://worker.test/', { headers: { [header]: '1' } }),
      {
        identity,
        get bundle(): unknown {
          throw new Error('bundle must not be read');
        },
        resources,
        bindings: {},
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'unsupported-renderer-capability',
      capability: 'rsc',
    });
  });

  it('admits a CSR fallback only when the build declares its header', async () => {
    const seen: NativeRequestContext[] = [];
    const bundle = {
      rendererIdentity: identity,
      nativeRequestHandler: documentHandler(seen),
      nativeCSRRequestHandler: documentHandler(seen),
    };
    for (const csrFallbackHeader of [undefined, 'x-modern-js-ssr-fallback']) {
      await dispatchNativeWorkerRequest(
        new Request('https://worker.test/?csr=1'),
        {
          identity,
          bundle,
          resources: { ...resources, csrFallbackHeader },
          bindings: {},
        },
      );
    }
    expect(seen.map(context => context.serverConfig?.forceCSR)).toEqual([
      false,
      true,
    ]);
  });

  it('keeps the Node host on the node platform', async () => {
    const seen: NativeRequestContext[] = [];
    await dispatchNativeNodeRequest(new Request('https://node.test/'), {
      identity,
      // A caller cannot select another platform through the Node entry point.
      platform: 'worker',
      loadManifest: () => ({
        rendererIdentity: identity,
        nativeRequestHandler: documentHandler(seen),
      }),
      context: { bindings: {} },
    });
    expect(seen[0]!.session.platform.kind).toBe('node');
  });
});
