import {
  createRequestSession,
  type RequestSession,
} from '@modern-js/renderer-core/session';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@octanejs/tanstack-router';
import { attachRouterServerSsrUtils } from '@octanejs/tanstack-router/ssr/server';
import { rs } from '@rstest/core';
import { prepareOctaneRouterSerialization } from '../src/router-server-snapshot';
import { octaneRouterSnapshotAdapter } from '../src/router-snapshot';
import { RouteDataError } from '../src/routes';

const identity = {
  renderer: 'octane',
  appId: 'snapshot-test',
  entryName: 'main',
  buildId: 'source-profile-hash',
  protocolVersion: 1,
} as const;
const sessions = new Set<RequestSession>();
function session(bindings: object = {}) {
  const value = createRequestSession({
    request: new Request('https://snapshot.test/'),
    identity,
    platform: { kind: 'node', bindings },
  });
  sessions.add(value);
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let count = 0; count < 12; count++) await Promise.resolve();
}

async function nativeFixture(
  input: {
    data?: unknown;
    error?: unknown;
    beforeLoad?: unknown;
    dehydrate?: () => unknown | Promise<unknown>;
    owner?: RequestSession;
    forbiddenValues?: readonly object[];
    production?: boolean;
  } = {},
) {
  const owner = input.owner ?? session();
  const route = createRootRoute({
    beforeLoad: () => input.beforeLoad as Record<string, unknown> | undefined,
    loader: () => {
      if ('error' in input) throw input.error;
      return input.data;
    },
    errorComponent: () => null,
  });
  const router = createRouter({
    routeTree: route,
    isServer: true,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    dehydrate: input.dehydrate,
  });
  attachRouterServerSsrUtils({ router, manifest: undefined });
  const nativeSsr = router.serverSsr!;
  const guard = prepareOctaneRouterSerialization(router, owner, {
    forbiddenValues: input.forbiddenValues,
    production: input.production,
  });
  await router.load();
  guard.assertMatches();
  let bufferedScripts = '';
  const scripts = () => {
    bufferedScripts += nativeSsr.takeBufferedScripts()?.children ?? '';
    return bufferedScripts;
  };
  return {
    router,
    owner,
    guard,
    nativeSsr,
    async dehydrate() {
      await nativeSsr.dehydrate();
      guard.assertActive();
    },
    snapshot() {
      return replayNativeScripts(scripts()) as {
        manifest: unknown;
        matches: Array<Record<string, any>>;
        dehydratedData?: unknown;
      };
    },
    scripts,
  };
}

// Replay exactly the released native serializer's emitted bootstrap and queued
// closures in this realm, with the same decoder Map installed by native hydrate.
function replayNativeScripts(script: string) {
  const scope: Record<string, any> = {};
  const document = { currentScript: { remove() {} } };
  new Function('self', 'document', `with(self) { ${script} }`)(scope, document);
  scope.$_TSR.t = new Map([
    [
      octaneRouterSnapshotAdapter.key,
      octaneRouterSnapshotAdapter.fromSerializable,
    ],
  ]);
  scope.$_TSR.initialized = true;
  for (const queued of scope.$_TSR.buffer) queued();
  scope.$_TSR.buffer = [];
  return scope.$_TSR.router as { matches: Array<Record<string, any>> };
}

beforeEach(() => rs.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(async () => {
  for (const owner of sessions)
    owner.abort(new Error('Snapshot test finished'));
  await Promise.all([...sessions].map(owner => owner.completion));
  sessions.clear();
  rs.restoreAllMocks();
});

describe('native Octane public router snapshots', () => {
  it('projects the fresh native outer record without mutating route values and preserves rich aliases and cycles', async () => {
    const shared: Record<string, unknown> = { label: 'visible' };
    shared.self = shared;
    const date = new Date('2026-10-02T12:00:00Z');
    const regex = /tractor/giu;
    const data = {
      shared,
      alias: shared,
      date,
      regex,
      map: new Map([[shared, date]]),
      set: new Set([shared]),
    };
    const fixture = await nativeFixture({
      data,
      beforeLoad: { tenant: 'public' },
      dehydrate: () => ({ extra: shared }),
    });
    await fixture.dehydrate();
    const snapshot = fixture.snapshot();
    const projected = snapshot.matches[0]!.l;
    expect(fixture.router.stores.matches.get()[0]!.loaderData).toBe(data);
    expect(projected).not.toBe(data);
    expect(projected.shared).toBe(projected.alias);
    expect(projected.shared.self).toBe(projected.shared);
    expect(projected.date).toEqual(date);
    expect(projected.regex).toEqual(regex);
    expect(projected.map.get(projected.shared)).toBe(projected.date);
    expect(projected.set.has(projected.shared)).toBe(true);
    expect(snapshot.dehydratedData).toEqual({ extra: projected.shared });
    expect((snapshot.dehydratedData as { extra: unknown }).extra).toBe(
      projected.shared,
    );
    expect(snapshot.matches[0]!.b).toEqual({ tenant: 'public' });
    const scripts = fixture.scripts();
    expect(scripts).toContain('$_TSR.p');
    expect(scripts).toContain(octaneRouterSnapshotAdapter.key);
    const decoded = replayNativeScripts(scripts).matches[0]!.l;
    expect(decoded.shared.self).toBe(decoded.shared);
    expect(decoded.shared).toBe(decoded.alias);
    expect(decoded.map.get(decoded.shared)).toBe(decoded.date);
  });

  it('stops waiting for a custom dehydrate hook after the request aborts', async () => {
    const owner = session();
    const late = deferred<unknown>();
    let started!: () => void;
    const begun = new Promise<void>(resolve => {
      started = resolve;
    });
    const fixture = await nativeFixture({
      owner,
      dehydrate: () => {
        started();
        return late.promise;
      },
    });
    const pending = (
      fixture.router.options.dehydrate as () => Promise<unknown>
    )();
    await begun;
    const reason = new Error('request cancelled while dehydrating');
    owner.abort(reason);
    await expect(pending).rejects.toBe(reason);
    // A late failure of the abandoned hook is observed, not unhandled.
    late.reject(new Error('late dehydrate failure'));
    await flush();
  });

  it.each(['critical', 'promise'] as const)(
    'never reads a %s constructor installed during the native asynchronous dehydrate hook',
    async kind => {
      let getters = 0;
      const original =
        kind === 'critical' ? { value: 'visible' } : Promise.resolve('visible');
      const fixture = await nativeFixture({
        data: { slot: original },
        dehydrate: () =>
          Promise.resolve().then(() => {
            Object.defineProperty(original, 'constructor', {
              get() {
                getters++;
                throw new Error('PRIVATE_CONSTRUCTOR');
              },
            });
          }),
      });
      await expect(fixture.dehydrate()).rejects.toThrow(
        /accessors|without own fields/,
      );
      expect(getters).toBe(0);
      expect(
        (
          fixture.router.stores.matches.get()[0]!.loaderData as {
            slot: unknown;
          }
        ).slot,
      ).toBe(original);
      expect(fixture.owner.signal.aborted).toBe(true);
      expect((await fixture.owner.completion).cacheEligible).toBe(false);
      expect(fixture.nativeSsr.takeBufferedHtml() ?? '').not.toContain(
        'PRIVATE_CONSTRUCTOR',
      );
    },
  );

  it.each([
    'getter',
    'index',
    'constructor',
    'request',
    'nested-promise',
  ] as const)(
    'fails late %s poison without reaching native Seroval or cache admission',
    async kind => {
      const late = deferred<unknown>();
      let getters = 0;
      const poison = kind === 'index' ? [] : {};
      if (kind === 'getter' || kind === 'index' || kind === 'constructor') {
        Object.defineProperty(
          poison,
          kind === 'index'
            ? '0'
            : kind === 'constructor'
              ? 'constructor'
              : 'private',
          {
            enumerable: true,
            get() {
              getters++;
              return 'PRIVATE_SETTLEMENT';
            },
          },
        );
      }
      const value =
        kind === 'request'
          ? new Request('https://private.test/PRIVATE_SETTLEMENT')
          : kind === 'nested-promise'
            ? { nested: Promise.resolve('PRIVATE_SETTLEMENT') }
            : poison;
      const data = {
        critical: 'visible',
        first: late.promise,
        alias: late.promise,
      };
      const fixture = await nativeFixture({ data });
      await fixture.dehydrate();
      const projected = fixture.snapshot().matches[0]!.l;
      expect(projected.first).toBe(projected.alias);
      expect(projected.first).not.toBe(late.promise);
      expect(fixture.router.stores.matches.get()[0]!.loaderData).toBe(data);
      expect(fixture.scripts()).toContain('visible');
      late.resolve(value);
      await flush();
      expect(getters).toBe(0);
      expect(fixture.owner.signal.aborted).toBe(true);
      expect((await fixture.owner.completion).state).toBe('failed');
      expect((await fixture.owner.completion).cacheEligible).toBe(false);
      expect(fixture.nativeSsr.takeBufferedHtml() ?? '').not.toContain(
        'PRIVATE_SETTLEMENT',
      );
    },
  );

  it('rejects a malicious Promise species without calling its nested getter or constructor', async () => {
    let getters = 0;
    const promise = Promise.resolve('visible');
    Object.defineProperty(promise, 'constructor', {
      value: {
        get [Symbol.species]() {
          getters++;
          return Promise;
        },
      },
    });
    const fixture = await nativeFixture({ data: { late: promise } });
    await expect(fixture.dehydrate()).rejects.toThrow('without own fields');
    expect(getters).toBe(0);
  });

  it('fails an already fulfilled poisoned Promise before the native response callback can run', async () => {
    let getters = 0;
    const poison = Object.defineProperty({}, 'private', {
      enumerable: true,
      get() {
        getters++;
        return 'SECRET';
      },
    });
    const fixture = await nativeFixture({
      data: { late: Promise.resolve(poison) },
    });
    let responseCallbacks = 0;
    await fixture.nativeSsr.dehydrate();
    expect(() => {
      fixture.guard.assertActive();
      responseCallbacks++;
    }).toThrow();
    expect(responseCallbacks).toBe(0);
    expect(getters).toBe(0);
    expect(fixture.owner.signal.aborted).toBe(true);
  });

  it('retains native deferred success and standard Error rejection through the emitted bootstrap', async () => {
    const success = deferred<unknown>();
    const rejected = deferred<unknown>();
    const data = Object.freeze({
      success: success.promise,
      alias: success.promise,
      rejected: rejected.promise,
    });
    const fixture = await nativeFixture({ data });
    await fixture.dehydrate();
    const failure = new TypeError('Public deferred failure', {
      cause: { code: 'PUBLIC' },
    });
    let stackReads = 0;
    Object.defineProperty(failure, 'stack', {
      configurable: true,
      get() {
        stackReads++;
        return 'PRIVATE_STACK';
      },
    });
    success.resolve({ visible: 'settled' });
    rejected.reject(failure);
    await flush();
    fixture.guard.assertActive();
    expect(stackReads).toBe(0);
    expect(fixture.owner.signal.aborted).toBe(false);
    expect(fixture.nativeSsr.isSerializationFinished()).toBe(true);
    const decoded = replayNativeScripts(fixture.scripts()).matches[0]!.l;
    expect(decoded.success).toBe(decoded.alias);
    await expect(decoded.success).resolves.toEqual({ visible: 'settled' });
    const received = await decoded.rejected.catch((error: unknown) => error);
    expect(received).toBeInstanceOf(TypeError);
    expect(received.message).toBe('Public deferred failure');
    expect(received.cause).toEqual({ code: 'PUBLIC' });
  });

  it('projects a genuine match Error without reading lazy stack and reconstructs the owned RouteDataError', async () => {
    const error = new RouteDataError('item', {
      kind: 'error',
      status: 422,
      thrown: true,
      error: { name: 'ValidationError', message: 'Public invalid item' },
      data: { field: 'quantity' },
    });
    let stackReads = 0;
    Object.defineProperty(error, 'stack', {
      configurable: true,
      get() {
        stackReads++;
        return 'PRIVATE_STACK';
      },
    });
    const fixture = await nativeFixture({ error });
    await fixture.dehydrate();
    expect(stackReads).toBe(0);
    expect(fixture.router.stores.matches.get()[0]!.error).toBe(error);
    const decoded = replayNativeScripts(fixture.scripts()).matches[0]!.e;
    expect(decoded).toBeInstanceOf(RouteDataError);
    expect(decoded.routeId).toBe('item');
    expect(decoded.status).toBe(422);
    expect(decoded.data).toEqual({ field: 'quantity' });
    expect(decoded.message).toBe('Public invalid item');
  });

  it('rejects ordinary Error loader values and arbitrary match Error subclasses or extra fields', async () => {
    class PrivateError extends Error {}
    for (const input of [
      { data: new Error('PRIVATE') },
      { error: new PrivateError('PRIVATE') },
      {
        error: Object.assign(new Error('PRIVATE'), {
          request: new Request('https://private.test/'),
        }),
      },
    ]) {
      const fixture = await nativeFixture(input);
      await expect(fixture.dehydrate()).rejects.toThrow();
      expect(fixture.owner.signal.aborted).toBe(true);
    }
  });

  it('checks forbidden plain request context identities even in explicit beforeLoad data or consumer dehydration', async () => {
    for (const slot of ['loader', 'beforeLoad', 'dehydrate'] as const) {
      const privateContext = { tenantSecret: 'PRIVATE_CONTEXT' };
      const fixture = await nativeFixture({
        data: slot === 'loader' ? { privateContext } : { public: true },
        beforeLoad: slot === 'beforeLoad' ? privateContext : undefined,
        dehydrate:
          slot === 'dehydrate' ? () => ({ privateContext }) : undefined,
        forbiddenValues: [privateContext],
      });
      await expect(fixture.dehydrate()).rejects.toThrow(
        'Request-private context',
      );
      expect(fixture.nativeSsr.takeBufferedHtml() ?? '').not.toContain(
        'PRIVATE_CONTEXT',
      );
    }
  });

  it.each(['locals', 'map-key', 'map-value', 'set'] as const)(
    'rejects nested private %s identities before native publication',
    async kind => {
      const privateDescendant = { token: 'PRIVATE_DESCENDANT' };
      const bindings = {
        locals:
          kind === 'locals'
            ? privateDescendant
            : kind === 'map-key'
              ? new Map([[privateDescendant, 'value']])
              : kind === 'map-value'
                ? new Map([['key', privateDescendant]])
                : new Set([privateDescendant]),
      };
      let getters = 0;
      Object.defineProperty(bindings, 'lazyContext', {
        get() {
          getters++;
          return { token: 'PRIVATE_GETTER' };
        },
      });
      const data = { privateDescendant };
      const fixture = await nativeFixture({ owner: session(bindings), data });
      await expect(fixture.dehydrate()).rejects.toThrow(
        'Request-private context',
      );
      expect(getters).toBe(0);
      expect(fixture.router.stores.matches.get()[0]!.loaderData).toBe(data);
      expect(fixture.owner.signal.aborted).toBe(true);
      expect((await fixture.owner.completion).cacheEligible).toBe(false);
      expect(fixture.nativeSsr.takeBufferedHtml() ?? '').not.toContain(
        'PRIVATE_DESCENDANT',
      );
    },
  );

  it('retains captured private aliases after a consumer dehydrate hook removes their context path', async () => {
    const privateAlias = { token: 'REMOVED_PRIVATE_ALIAS' };
    const bindings: { locals?: object } = { locals: privateAlias };
    const fixture = await nativeFixture({
      owner: session(bindings),
      data: { privateAlias },
      dehydrate: () => {
        delete bindings.locals;
        return { public: true };
      },
    });
    await expect(fixture.dehydrate()).rejects.toThrow(
      'Request-private context',
    );
    expect(bindings.locals).toBeUndefined();
    expect(fixture.nativeSsr.takeBufferedHtml() ?? '').not.toContain(
      'REMOVED_PRIVATE_ALIAS',
    );
  });

  it('refreshes private descendants at deferred settlement without evaluating context getters', async () => {
    const late = deferred<unknown>();
    const bindings: { locals?: object } = {};
    let getters = 0;
    Object.defineProperty(bindings, 'lazyContext', {
      get() {
        getters++;
        return { token: 'PRIVATE_GETTER' };
      },
    });
    const data = { critical: 'visible', late: late.promise };
    const fixture = await nativeFixture({ owner: session(bindings), data });
    await fixture.dehydrate();
    const initialScripts = fixture.scripts();
    const privateDescendant = { token: 'NEW_PRIVATE_DESCENDANT' };
    bindings.locals = { entries: new Set([privateDescendant]) };
    late.resolve({ privateDescendant });
    await flush();
    expect(getters).toBe(0);
    expect(fixture.router.stores.matches.get()[0]!.loaderData).toBe(data);
    expect(fixture.owner.signal.aborted).toBe(true);
    expect((await fixture.owner.completion).state).toBe('failed');
    expect((await fixture.owner.completion).cacheEligible).toBe(false);
    expect(initialScripts).toContain('visible');
    expect(
      initialScripts + (fixture.nativeSsr.takeBufferedHtml() ?? ''),
    ).not.toContain('NEW_PRIVATE_DESCENDANT');
  });

  it.each(['resolve', 'reject'] as const)(
    'rechecks an original deferred Promise made private before %s',
    async settlement => {
      const late = deferred<unknown>();
      const bindings: { pending?: Promise<unknown> } = {};
      const fixture = await nativeFixture({
        owner: session(bindings),
        data: { late: late.promise },
      });
      await fixture.dehydrate();
      bindings.pending = late.promise;
      if (settlement === 'resolve') late.resolve({ visible: true });
      else late.reject(new TypeError('Public failure'));
      await flush();
      expect(fixture.owner.signal.aborted).toBe(true);
      expect((await fixture.owner.completion).cacheEligible).toBe(false);
      expect(
        (
          fixture.router.stores.matches.get()[0]!.loaderData as {
            late: unknown;
          }
        ).late,
      ).toBe(late.promise);
    },
  );

  it('rejects original private Error identities in the native deferred error channel', async () => {
    const late = deferred<unknown>();
    const bindings: { failure?: Error } = {};
    const fixture = await nativeFixture({
      owner: session(bindings),
      data: { late: late.promise },
    });
    await fixture.dehydrate();
    const initialScripts = fixture.scripts();
    const failure = new TypeError('PRIVATE_REJECTION');
    bindings.failure = failure;
    late.reject(failure);
    await flush();
    expect(fixture.owner.signal.aborted).toBe(true);
    expect((await fixture.owner.completion).cacheEligible).toBe(false);
    expect(
      initialScripts + (fixture.nativeSsr.takeBufferedHtml() ?? ''),
    ).not.toContain('PRIVATE_REJECTION');
  });

  it('revalidates cached RouteDataError data when it becomes private between deferred rejections', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const bindings: { locals?: object } = {};
    const routeData = { field: 'quantity' };
    const error = new RouteDataError('item', {
      kind: 'error',
      status: 422,
      thrown: true,
      error: { name: 'ValidationError', message: 'Public validation failure' },
      data: routeData,
    });
    const data = { first: first.promise, second: second.promise };
    const fixture = await nativeFixture({ owner: session(bindings), data });
    await fixture.dehydrate();
    first.reject(error);
    await flush();
    fixture.guard.assertActive();
    expect(fixture.owner.signal.aborted).toBe(false);
    bindings.locals = routeData;
    second.reject(error);
    await flush();
    expect(fixture.owner.signal.aborted).toBe(true);
    expect((await fixture.owner.completion).state).toBe('failed');
    expect((await fixture.owner.completion).cacheEligible).toBe(false);
    expect(fixture.router.stores.matches.get()[0]!.loaderData).toBe(data);
    expect(error.data).toBe(routeData);
  });

  it('preserves independent public rich graphs beside structurally identical private context', async () => {
    const privateValue = { label: 'same shape' };
    const publicValue = { label: 'same shape' };
    const data = {
      value: publicValue,
      alias: publicValue,
      map: new Map([[publicValue, new Date('2026-10-03T00:00:00Z')]]),
      set: new Set([publicValue]),
    };
    const fixture = await nativeFixture({
      owner: session({ locals: privateValue }),
      data,
    });
    await fixture.dehydrate();
    const received = fixture.snapshot().matches[0]!.l;
    expect(received.value).toEqual(publicValue);
    expect(received.value).toBe(received.alias);
    expect(received.map.get(received.value)).toBeInstanceOf(Date);
    expect(received.set.has(received.value)).toBe(true);
    expect(fixture.owner.signal.aborted).toBe(false);
    expect(fixture.router.stores.matches.get()[0]!.loaderData).toBe(data);
  });

  it('rejects unproven consumer adapters instead of allowing them to alter the checked graph', () => {
    const router = createRouter({
      routeTree: createRootRoute(),
      isServer: true,
    });
    const options = {
      ...router.options,
      serializationAdapters: [
        { ...octaneRouterSnapshotAdapter, key: 'consumer' },
      ],
    };
    router.update(options);
    expect(() => prepareOctaneRouterSerialization(router, session())).toThrow(
      'custom serializationAdapters are not admitted',
    );
  });

  it('rejects adapter replacement across an awaited consumer dehydrate hook before native serialization', async () => {
    let getters = 0;
    let unsafeCalls = 0;
    const poison = Object.defineProperty({}, 'constructor', {
      get() {
        getters++;
        return Object;
      },
    });
    let fixture!: Awaited<ReturnType<typeof nativeFixture>>;
    fixture = await nativeFixture({
      data: poison,
      dehydrate: async () => {
        await Promise.resolve();
        const options = {
          ...fixture.router.options,
          serializationAdapters: [
            {
              ...octaneRouterSnapshotAdapter,
              test: (_value: unknown): _value is any => true,
              toSerializable: (value: unknown) => {
                unsafeCalls++;
                return value;
              },
            },
          ],
        };
        fixture.router.update(options);
      },
    });
    await expect(fixture.dehydrate()).rejects.toThrow(
      'serializer owner was replaced',
    );
    expect(unsafeCalls).toBe(0);
    expect(getters).toBe(0);
    expect(fixture.owner.signal.aborted).toBe(true);
  });

  it.each(['inherited', 'id', 'routeId'] as const)(
    'rejects %s metadata before native pre-adapter reads can execute user code',
    async kind => {
      let getters = 0;
      const fixture = await nativeFixture({ data: 'visible' });
      const match = fixture.router.stores.matches.get()[0]!;
      if (kind === 'inherited') {
        delete match.loaderData;
        Object.setPrototypeOf(match, {
          get loaderData() {
            getters++;
            return 'PRIVATE';
          },
        });
      } else {
        Object.defineProperty(match, kind, {
          value: {
            get replaceAll() {
              getters++;
              return () => 'PRIVATE';
            },
          },
        });
      }
      await expect(
        (async () => {
          fixture.guard.assertMatches();
          await fixture.nativeSsr.dehydrate();
        })(),
      ).rejects.toThrow();
      expect(getters).toBe(0);
    },
  );

  it.each(['styles', 'headScripts'] as const)(
    'rejects native %s before the fragment host can render unsupported document tags',
    async field => {
      const fixture = await nativeFixture({ data: 'visible' });
      Object.assign(fixture.router.stores.matches.get()[0]!, {
        [field]: [{ children: 'PRIVATE_HEAD' }],
      });
      expect(() => fixture.guard.assertMatches()).toThrow(
        'styles/headScripts are not admitted',
      );
      expect(fixture.owner.signal.aborted).toBe(true);
    },
  );

  it('uses the shared production error policy for opaque native errors while retaining explicit public route errors', async () => {
    const late = deferred<unknown>();
    const fixture = await nativeFixture({
      data: { late: late.promise },
      production: true,
    });
    await fixture.dehydrate();
    late.reject(
      new TypeError('PRIVATE_DATABASE_SECRET', {
        cause: { password: 'PRIVATE_CAUSE_SECRET' },
      }),
    );
    await flush();
    fixture.guard.assertActive();
    const scripts = fixture.scripts();
    expect(scripts).not.toContain('PRIVATE_DATABASE_SECRET');
    expect(scripts).not.toContain('PRIVATE_CAUSE_SECRET');
    const received = await replayNativeScripts(
      scripts,
    ).matches[0]!.l.late.catch((error: unknown) => error);
    expect(received.name).toBe('Error');
    expect(received.message).toBe('Unexpected Server Error');
    expect(received.cause).toBeUndefined();
    const routeError = new RouteDataError('item', {
      kind: 'error',
      status: 422,
      thrown: true,
      error: { name: 'ValidationError', message: 'Public validation failure' },
      data: { field: 'quantity' },
    });
    const publicFixture = await nativeFixture({
      error: routeError,
      production: true,
    });
    await publicFixture.dehydrate();
    const publicError = replayNativeScripts(publicFixture.scripts()).matches[0]!
      .e;
    expect(publicError).toBeInstanceOf(RouteDataError);
    expect(publicError.message).toBe('Public validation failure');
    expect(publicError.status).toBe(422);
  });

  it('does not inspect deferred source values after the request owner has been aborted', async () => {
    const late = deferred<unknown>();
    let getters = 0;
    const fixture = await nativeFixture({ data: { late: late.promise } });
    await fixture.dehydrate();
    fixture.owner.abort(new Error('Client disconnected'));
    await fixture.owner.completion;
    late.resolve(
      Object.defineProperty({}, 'private', {
        get() {
          getters++;
          return 'PRIVATE_AFTER_ABORT';
        },
      }),
    );
    await flush();
    expect(getters).toBe(0);
    expect((await fixture.owner.completion).state).toBe('aborted');
    expect(fixture.nativeSsr.takeBufferedHtml() ?? '').not.toContain(
      'PRIVATE_AFTER_ABORT',
    );
  });
});
