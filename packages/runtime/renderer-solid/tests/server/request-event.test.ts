import {
  type DataOutcome,
  DataProtocolError,
  type FileSystemRouteIR,
} from '@modern-js/renderer-core/data';
import {
  createRequestSession,
  type RequestSession,
} from '@modern-js/renderer-core/session';
import { getRequestEvent, httpHeader, httpStatus, ssr } from '@solidjs/web';
import {
  createComponent,
  createMemo,
  createRoot,
  Loading,
  onCleanup,
} from 'solid-js';
import {
  ApplicationRouter,
  createApplicationRouter,
  createFileSystemRouteTree,
  createMemoryHistory,
  useLoaderData,
} from '../../src/router';
import {
  MATCH_KEY_PREFIX,
  prepareRouterMatchTransfer,
} from '../../src/router-binding/registryTransfer';
import {
  renderApplication,
  renderCSRDocument,
  renderDocumentApplication,
  runApplicationRequest,
} from '../../src/server';

const privateMarker = 'REQUEST_EVENT_PRIVATE_AUTH_681';

function createSession(name: string, bindings: Record<string, unknown> = {}) {
  return createRequestSession({
    request: new Request(`https://shop.test/${name}`),
    identity: {
      renderer: 'solid',
      appId: 'request-event',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'build-a',
    },
    platform: { kind: 'node', bindings },
  });
}

function resolveDocument(session: RequestSession) {
  session.resolveResponse({
    kind: 'document',
    status: 200,
    headers: [['content-type', 'text/html; charset=utf-8']],
    cache: { mode: 'public', maxAgeSeconds: 30 },
  });
}

function requestEvent() {
  const event = getRequestEvent();
  if (!event) throw new Error('Expected the native Solid request event.');
  return event;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

async function readRemaining(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  prefix: string,
) {
  let html = prefix;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return html;
    html += new TextDecoder().decode(chunk.value);
  }
}

const routes: FileSystemRouteIR[] = [
  {
    id: 'layout',
    isRoot: true,
    children: [{ id: 'item', path: 'item', children: [] }],
  },
];

describe('native Solid application request event', () => {
  test('async handler work retains the exact request, private locals and native response stub', async () => {
    const bindings = { authorization: privateMarker };
    const session = createSession('handler', bindings);
    const middleware = { authorization: privateMarker };
    const callbackResult = { prepared: true };
    let initialEvent: ReturnType<typeof getRequestEvent>;

    const result = await runApplicationRequest(session, async () => {
      const event = requestEvent();
      initialEvent = event;
      expect(session.state).toBe('matching');
      expect(event.request).toBe(session.request);
      expect(event.locals.session).toBe(session);
      expect(event.locals.bindings).toBe(bindings);
      event.locals.middleware = middleware;
      const stub = Object.getOwnPropertyDescriptor(event, 'response')?.value;
      expect(stub).toMatchObject({ committed: false });
      expect(stub.headers).toBeInstanceOf(Headers);
      expect(stub.status).toBeUndefined();

      await Promise.resolve();
      expect(requestEvent()).toBe(event);
      expect(requestEvent().locals.middleware).toBe(middleware);

      createRoot(dispose => {
        httpStatus(202, 'Accepted');
        httpHeader('x-native-event', 'handler');
        expect(stub.status).toBe(202);
        expect(stub.statusText).toBe('Accepted');
        expect(stub.headers.get('x-native-event')).toBe('handler');
        dispose();
      });
      expect(stub.status).toBeUndefined();
      expect(stub.headers.has('x-native-event')).toBe(false);
      return callbackResult;
    });

    expect(result).toBe(callbackResult);
    resolveDocument(session);
    const response = await renderApplication({
      session,
      view: () => {
        expect(requestEvent()).toBe(initialEvent);
        expect(requestEvent().locals.middleware).toBe(middleware);
        return ssr('<main>prepared handler</main>');
      },
    });
    expect(await response.text()).toContain('prepared handler');
    expect((await session.completion).state).toBe('completed');
  });

  test('request work that ignores cancellation releases the request and its late body', async () => {
    const session = createSession('ignores-abort');
    const cleanup = rstest.fn();
    session.registerCleanup(cleanup);
    const late = Promise.withResolvers<Response>();
    let working!: () => void;
    const started = new Promise<void>(resolve => {
      working = resolve;
    });
    const pending = runApplicationRequest(session, () => {
      working();
      return late.promise;
    });
    await started;
    const reason = new DOMException('Client disconnected', 'AbortError');
    session.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect((await session.completion).state).toBe('aborted');
    expect(cleanup).toHaveBeenCalledTimes(1);
    const cancelled = rstest.fn();
    late.resolve(new Response(new ReadableStream({ cancel: cancelled })));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  test('nested wrappers and document rendering reuse one native event and locals bag', async () => {
    const session = createSession('nested');
    const middleware = { token: privateMarker };
    const response = await runApplicationRequest(session, async () => {
      const event = requestEvent();
      const locals = event.locals;
      locals.middleware = middleware;

      await runApplicationRequest(session, async () => {
        expect(requestEvent()).toBe(event);
        expect(requestEvent().locals).toBe(locals);
        await Promise.resolve();
        expect(requestEvent()).toBe(event);
        expect(requestEvent().locals.middleware).toBe(middleware);
      });

      expect(requestEvent()).toBe(event);
      resolveDocument(session);
      return renderDocumentApplication({
        session,
        view: () => {
          expect(requestEvent()).toBe(event);
          expect(requestEvent().locals).toBe(locals);
          expect(requestEvent().locals.middleware).toBe(middleware);
          return ssr('<main>one native event</main>');
        },
      });
    });

    expect(await response.text()).toContain('one native event');
    expect((await session.completion).state).toBe('completed');
  });

  test('CSR commits the native event created by asynchronous handler work', async () => {
    const session = createSession('csr');
    const response = await runApplicationRequest(session, async () => {
      const event = requestEvent();
      const locals = event.locals;
      const stub = Object.getOwnPropertyDescriptor(event, 'response')?.value;
      locals.middleware = { token: privateMarker };
      await Promise.resolve();
      resolveDocument(session);
      const document = renderCSRDocument({ session });
      expect(requestEvent()).toBe(event);
      expect(requestEvent().locals).toBe(locals);
      expect(stub.committed).toBe(true);
      return document;
    });

    const html = await response.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain(privateMarker);
    expect((await session.completion).state).toBe('completed');
  });

  test('warmed requests keep their events through deferred streams without native warnings', async () => {
    const warn = console.warn.bind(console);
    const warningSpy = rstest.spyOn(console, 'warn').mockImplementation(warn);
    const firstValue = deferred<string>();
    const secondValue = deferred<string>();
    const first = createSession('first', { requestId: 'first' });
    const second = createSession('second', { requestId: 'second' });

    async function openStream(
      session: ReturnType<typeof createSession>,
      value: Promise<string>,
      name: string,
    ) {
      const observations: Array<{
        stage: string;
        event: ReturnType<typeof getRequestEvent>;
      }> = [];
      let initialEvent: ReturnType<typeof getRequestEvent>;
      const observe = (stage: string) => {
        observations.push({ stage, event: getRequestEvent() });
      };
      const response = await runApplicationRequest(session, async () => {
        initialEvent = requestEvent();
        initialEvent.locals.middleware = { requestId: name };
        observe('handler');
        await Promise.resolve();
        observe('handler-after-await');
        let authoredDeferred: Promise<string> | undefined;
        const routeTree = createFileSystemRouteTree(
          [
            {
              id: 'layout',
              isRoot: true,
              children: [
                {
                  id: 'item',
                  path: name,
                  modules: { data: `/${name}.data.ts` },
                  children: [],
                },
              ],
            },
          ],
          {
            item: {
              component: () => {
                observe('view');
                onCleanup(() => observe('cleanup'));
                const data = useLoaderData({ strict: false })();
                expect(Object.isFrozen(data)).toBe(true);
                const later = Object.getOwnPropertyDescriptor(
                  data,
                  'later',
                )?.value;
                if (!(later instanceof Promise))
                  throw new Error(
                    'Expected checked native deferred loader data.',
                  );
                expect(later).not.toBe(authoredDeferred);
                expect(Object.isSealed(later)).toBe(true);
                const memo = createMemo(async () => {
                  observe('native-memo');
                  const result = await later;
                  observe('native-memo-after-await');
                  return result;
                });
                return ssr(
                  ['<main><h1>', '</h1>', '</main>'],
                  Object.getOwnPropertyDescriptor(data, 'ready')?.value,
                  createComponent(Loading, {
                    fallback: ssr(`<p>waiting ${name}</p>`),
                    get children() {
                      return ssr(['<p>', '</p>'], () => memo());
                    },
                  }),
                );
              },
            },
          },
          {
            request: session.request,
            session,
            loadRoute: async () => {
              observe('loader');
              await Promise.resolve();
              observe('loader-after-await');
              observe('deferred-registration');
              authoredDeferred = value.then(result => {
                observe('deferred-settlement');
                return result;
              });
              const outcome: DataOutcome = {
                kind: 'deferred',
                critical: { ready: `critical ${name}` },
                deferred: { later: authoredDeferred },
                response: {
                  status: 200,
                  statusText: 'OK',
                  headers: [],
                  cachePolicy: 'public',
                },
              };
              return outcome;
            },
          },
        );
        const router = createApplicationRouter({
          routeTree,
          history: createMemoryHistory({ initialEntries: [`/${name}`] }),
          isServer: true,
        });
        await router.load();
        expect(router.state.matches.at(-1)?.error).toBeUndefined();
        observe('transfer-preparation');
        prepareRouterMatchTransfer(router, session);
        resolveDocument(session);
        return renderDocumentApplication({
          session,
          document: { renderId: `${name}:` },
          view: () => createComponent(ApplicationRouter, { router }),
        });
      });
      return { response, event: initialEvent, observations };
    }

    try {
      const warm = createSession('warm');
      const warmResponse = await runApplicationRequest(warm, () => {
        expect(requestEvent().request).toBe(warm.request);
        resolveDocument(warm);
        return renderApplication({
          session: warm,
          view: () => ssr('<main>warm native request</main>'),
        });
      });
      await warmResponse.text();
      expect((await warm.completion).state).toBe('completed');

      const firstStream = await openStream(first, firstValue.promise, 'first');
      const firstReader = firstStream.response.body!.getReader();
      const firstShell = new TextDecoder().decode(
        (await firstReader.read()).value,
      );
      expect(firstShell).toContain('waiting first');
      expect(firstShell).toContain('critical first');
      expect(firstShell).toContain(MATCH_KEY_PREFIX);
      const secondStream = await openStream(
        second,
        secondValue.promise,
        'second',
      );
      const secondReader = secondStream.response.body!.getReader();
      const secondShell = new TextDecoder().decode(
        (await secondReader.read()).value,
      );
      expect(secondShell).toContain('waiting second');
      expect(secondShell).toContain('critical second');
      expect(secondShell).toContain(MATCH_KEY_PREFIX);

      secondValue.resolve('second result');
      const secondHTML = await readRemaining(secondReader, secondShell);
      expect(first.state).toBe('committed');
      firstValue.resolve('first result');
      const firstHTML = await readRemaining(firstReader, firstShell);
      expect(firstHTML).toContain('first result');
      expect(firstHTML).not.toContain('second result');
      expect(secondHTML).toContain('second result');
      expect(secondHTML).not.toContain('first result');
      expect(firstStream.event).not.toBe(secondStream.event);
      expect(firstStream.event?.locals).not.toBe(secondStream.event?.locals);

      for (const [session, stream, name] of [
        [first, firstStream, 'first'],
        [second, secondStream, 'second'],
      ] as const) {
        expect((await session.completion).state).toBe('completed');
        expect(stream.observations.map(({ stage }) => stage)).toEqual(
          expect.arrayContaining([
            'handler',
            'handler-after-await',
            'loader',
            'loader-after-await',
            'deferred-registration',
            'transfer-preparation',
            'view',
            'native-memo',
            'deferred-settlement',
            'native-memo-after-await',
            'cleanup',
          ]),
        );
        for (const { event } of stream.observations) {
          expect(event).toBe(stream.event);
          expect(event?.request).toBe(session.request);
          expect(event?.locals.session).toBe(session);
          expect(event?.locals.bindings).toBe(session.platform.bindings);
          expect(event?.locals.middleware).toEqual({ requestId: name });
        }
      }
      expect(warningSpy).not.toHaveBeenCalled();
    } finally {
      firstValue.resolve('late first');
      secondValue.resolve('late second');
      if (first.state !== 'completed') first.abort('test finished');
      if (second.state !== 'completed') second.abort('test finished');
      warningSpy.mockRestore();
    }
  });

  test.each(['synchronous', 'asynchronous'] as const)(
    '%s handler failure belongs to its request session',
    async kind => {
      const session = createSession(`failure-${kind}`);
      const error = new Error(`private ${kind} handler failure`);
      let initialEvent: ReturnType<typeof getRequestEvent>;
      let cleanupEvent: ReturnType<typeof getRequestEvent>;
      const cleanup = rstest.fn(() => {
        cleanupEvent = getRequestEvent();
      });
      const registerCleanup = () => {
        const event = requestEvent();
        initialEvent = event;
        session.registerCleanup(cleanup);
        return event;
      };
      const callback =
        kind === 'synchronous'
          ? () => {
              expect(registerCleanup().locals.session).toBe(session);
              throw error;
            }
          : async () => {
              const event = registerCleanup();
              await Promise.resolve();
              expect(requestEvent()).toBe(event);
              throw error;
            };

      await expect(runApplicationRequest(session, callback)).rejects.toBe(
        error,
      );
      expect(await session.completion).toMatchObject({
        state: 'failed',
        error,
      });
      expect(session.committedPolicy).toBeUndefined();
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanupEvent).toBe(initialEvent);
      expect(cleanupEvent?.request).toBe(session.request);
      expect(cleanupEvent?.locals.session).toBe(session);
      expect(cleanupEvent?.locals.bindings).toBe(session.platform.bindings);
    },
  );

  test('cancelling a deferred stream disposes its exact event while another handler is active', async () => {
    const first = createSession('cancelled');
    const second = createSession('active');
    const value = deferred<string>();
    const cleanup = rstest.fn();
    let initialEvent: ReturnType<typeof getRequestEvent>;
    const response = await runApplicationRequest(first, async () => {
      initialEvent = requestEvent();
      initialEvent.locals.middleware = { token: privateMarker };
      await Promise.resolve();
      resolveDocument(first);
      return renderApplication({
        session: first,
        view: () => {
          onCleanup(() => cleanup(getRequestEvent()));
          const data = createMemo(async () => await value.promise);
          return createComponent(Loading, {
            fallback: ssr('<p>waiting cancelled request</p>'),
            get children() {
              return ssr(['<p>', '</p>'], () => data());
            },
          });
        },
      });
    });
    const reader = response.body!.getReader();
    await reader.read();

    try {
      const secondResponse = await runApplicationRequest(second, async () => {
        const event = requestEvent();
        await Promise.resolve();
        await reader.cancel('client disconnected');
        expect(requestEvent()).toBe(event);
        expect(requestEvent().locals.session).toBe(second);
        resolveDocument(second);
        return renderApplication({
          session: second,
          view: () => ssr('<main>active handler</main>'),
        });
      });
      await secondResponse.text();
      expect((await first.completion).state).toBe('aborted');
      expect((await second.completion).state).toBe('completed');
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith(initialEvent);
      expect(initialEvent?.locals.session).toBe(first);
      expect(initialEvent?.locals.middleware).toEqual({ token: privateMarker });
    } finally {
      value.resolve('late cancelled value');
      if (first.state !== 'aborted') first.abort('test finished');
      if (second.state !== 'completed') second.abort('test finished');
    }
  });

  test.each([
    'Request',
    'Headers',
    'session',
    'bindings',
    'getter-bearing object',
    'nested plain alias',
    'locals bag',
  ] as const)(
    'managed router options reject private event.locals %s without reading getters',
    async kind => {
      let getterReads = 0;
      const bindings = { authorization: privateMarker };
      const session = createSession('item', bindings);
      const rejection = runApplicationRequest(session, async () => {
        const event = requestEvent();
        event.locals.authenticatedRequest = new Request(
          'https://internal.test/',
          {
            headers: { authorization: privateMarker },
          },
        );
        event.locals.authenticationHeaders = new Headers({
          authorization: privateMarker,
        });
        event.locals.privateRoot = Object.defineProperty(
          { nestedAlias: { authorization: privateMarker } },
          'authorization',
          {
            enumerable: true,
            get() {
              getterReads += 1;
              return privateMarker;
            },
          },
        );
        Object.defineProperty(event.locals, 'privateGetter', {
          enumerable: true,
          get() {
            getterReads += 1;
            return privateMarker;
          },
        });
        await Promise.resolve();
        expect(requestEvent()).toBe(event);
        const privateValues = {
          Request: event.locals.authenticatedRequest,
          Headers: event.locals.authenticationHeaders,
          session: event.locals.session,
          bindings: event.locals.bindings,
          'getter-bearing object': event.locals.privateRoot,
          'nested plain alias': event.locals.privateRoot.nestedAlias,
          'locals bag': event.locals,
        };
        const routeTree = createFileSystemRouteTree(
          routes,
          {},
          {
            request: session.request,
            session,
          },
        );
        return createApplicationRouter({
          routeTree,
          history: createMemoryHistory({ initialEntries: ['/item'] }),
          context: { payload: privateValues[kind] },
          isServer: true,
        });
      });

      await expect(rejection).rejects.toBeInstanceOf(DataProtocolError);
      if (kind === 'bindings' || kind === 'nested plain alias')
        await expect(rejection).rejects.toThrow('private request references');
      expect(getterReads).toBe(0);
      expect(session.committedPolicy).toBeUndefined();
      expect((await session.completion).state).toBe('failed');
      expect(Object.isFrozen(bindings)).toBe(false);
    },
  );
});
