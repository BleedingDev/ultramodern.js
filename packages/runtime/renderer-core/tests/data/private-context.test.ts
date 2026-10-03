import { describe, expect, it } from '@rstest/core';
import { readDataResponse } from '../../src/data/client';
import {
  createDataResponse,
  deferData,
  handleDataRequest,
  invokeRouteData,
} from '../../src/data/server';
import type { DataHandlerInput } from '../../src/data/types';
import type { RendererIdentity } from '../../src/identity';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'app',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'private-context',
};
const expected = { identity, routeId: 'private', operation: 'loader' as const };
const requestInput = <Context>(context: Context) => ({
  request: new Request('https://example.test/private'),
  routeId: 'private',
  params: { id: 'public-param' },
  context,
});
const pending = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('request-private data identities', () => {
  it('rejects loader/action binding identities and nested Map/Set/hidden aliases', async () => {
    const local = { secret: 'local-private' };
    const key = { secret: 'map-key-private' };
    const mapped = { secret: 'map-value-private' };
    const member = { secret: 'set-private' };
    const hidden = { secret: 'hidden-private' };
    const context = Object.defineProperty(
      {
        locals: { local },
        loaderContext: new Map([[key, mapped]]),
        members: new Set([member]),
      },
      'hidden',
      { value: hidden },
    );
    for (const method of ['GET', 'POST']) {
      for (const value of [
        context,
        context.locals,
        local,
        key,
        mapped,
        member,
        hidden,
        { ...context.locals },
      ]) {
        await expect(
          handleDataRequest({
            request: new Request(
              'https://example.test/private?__loader=private',
              { method },
            ),
            identity,
            context,
            selectRoute() {
              return {
                routeId: 'private',
                params: {},
                handler(input) {
                  expect(input.context).toBe(context);
                  return value;
                },
              };
            },
          }),
        ).rejects.toThrow(/Request-private context/);
      }
    }
    expect(context.locals.local).toBe(local);
    expect(context.loaderContext.get(key)).toBe(mapped);
  });

  it('captures removed aliases before selection and explicit dispatcher private roots', async () => {
    const privateValue = { secret: 'removed-private' };
    const context: { child?: object } = { child: privateValue };
    const session = {
      platform: { bindings: { secret: 'dispatcher-private' } },
    };
    for (const value of [
      privateValue,
      session,
      session.platform,
      session.platform.bindings,
    ]) {
      context.child = privateValue;
      await expect(
        handleDataRequest({
          request: new Request('https://example.test/private?__loader=private'),
          identity,
          context,
          privateValues: [session],
          selectRoute() {
            delete context.child;
            return { routeId: 'private', params: {}, handler: () => value };
          },
        }),
      ).rejects.toThrow(/Request-private context/);
    }
  });

  it('does not invoke private getters or iterators and permits copied rich public DTOs and URL params', async () => {
    let reads = 0;
    const privateMap = new Map([[{ secret: 'key' }, { secret: 'value' }]]);
    Object.defineProperty(privateMap, Symbol.iterator, {
      get() {
        reads++;
        throw new Error('iterator read');
      },
    });
    const context = Object.defineProperty(
      { privateMap, local: { label: 'public copy' } },
      'secret',
      {
        get() {
          reads++;
          throw new Error('private getter read');
        },
      },
    );
    const args = requestInput(context);
    const sparse = [0n, 1n];
    Reflect.deleteProperty(sparse, 0);
    const result = {
      label: context.local.label,
      params: args.params,
      date: new Date('2026-10-03T00:00:00Z'),
      regexp: /public/gi,
      map: new Map([['value', { copied: true }]]),
      set: new Set(['public']),
      sparse,
    };
    const outcome = await invokeRouteData(input => {
      expect(input.context).toBe(context);
      return result;
    }, args);
    expect(outcome.kind === 'success' && outcome.value).toBe(result);
    expect(
      await readDataResponse(
        createDataResponse(outcome, identity, expected),
        expected,
      ),
    ).toEqual({
      kind: 'success',
      value: result,
      status: 200,
    });
    expect(reads).toBe(0);
  });

  it('keeps the captured dispatcher context when a selector replaces its options', async () => {
    const original = { private: { secret: 'original-private' } };
    let received: unknown;
    const options = {
      request: new Request('https://example.test/private?__loader=private'),
      identity,
      context: original,
      selectRoute() {
        options.context = { private: { secret: 'replacement-private' } };
        return {
          routeId: 'private',
          params: {},
          handler(input: DataHandlerInput<typeof original>) {
            received = input.context;
            return input.context.private;
          },
        };
      },
    };
    await expect(handleDataRequest(options)).rejects.toThrow(
      /Request-private context/,
    );
    expect(received).toBe(original);
  });

  it('seeds private Map/Set subclass entries with intrinsic iteration', async () => {
    let reads = 0;
    class PrivateMap extends Map {
      override get [Symbol.iterator]() {
        reads++;
        throw new Error('subclass map iterator read');
      }
    }
    class PrivateSet extends Set {
      override get [Symbol.iterator]() {
        reads++;
        throw new Error('subclass set iterator read');
      }
    }
    const key = { secret: 'subclass-key-private' };
    const value = { secret: 'subclass-value-private' };
    const member = { secret: 'subclass-member-private' };
    const context = {
      map: new PrivateMap([[key, value]]),
      set: new PrivateSet([member]),
    };
    for (const result of [key, value, member]) {
      await expect(
        invokeRouteData(() => result, requestInput(context)),
      ).rejects.toThrow(/Request-private context/);
    }
    expect(reads).toBe(0);
  });

  it('rejects private critical data and rechecks retained callback data before serialization', async () => {
    const context = { local: { secret: 'critical-private' } };
    await expect(
      invokeRouteData(
        () => deferData({ private: context.local }, {}),
        requestInput(context),
      ),
    ).rejects.toThrow(/Request-private context/);
    const result: { public: string; private?: object } = { public: 'safe' };
    const outcome = await invokeRouteData(() => result, requestInput(context));
    result.private = context.local;
    expect(() => createDataResponse(outcome, identity, expected)).toThrow(
      /Request-private context/,
    );
    expect(result.private).toBe(context.local);
  });

  it('rejects private deferred settlements without changing the authored result or emitting secret bytes', async () => {
    const context = { local: { secret: 'deferred-private' } };
    const work = pending();
    const critical = { public: 'critical' };
    const authored = deferData(critical, { later: work.promise });
    const outcome = await invokeRouteData(
      () => authored,
      requestInput(context),
    );
    expect(authored.critical).toBe(critical);
    expect(authored.deferred.later).toBe(work.promise);
    const response = createDataResponse(outcome, identity, expected);
    const wire = response.clone().text();
    const decoded = await readDataResponse(response, expected);
    expect(decoded.kind).toBe('success');
    if (decoded.kind !== 'success')
      throw new Error('Expected deferred success');
    const value = decoded.value as { public: string; later: Promise<unknown> };
    expect(value.public).toBe('critical');
    work.resolve(context.local);
    await expect(value.later).rejects.toThrow('Unexpected Server Error');
    await decoded.completion;
    expect(await wire).not.toContain('deferred-private');
    expect(await work.promise).toBe(context.local);
  });

  it('rechecks private aliases introduced while response headers are constructed', async () => {
    const context = { local: { secret: 'header-window-private' } };
    for (const deferred of [false, true]) {
      const result: { public: string; private?: object } = { public: 'safe' };
      const outcome = await invokeRouteData(
        () => (deferred ? deferData(result, {}) : result),
        requestInput(context),
      );
      let iterations = 0;
      Object.defineProperty(outcome.response.headers, Symbol.iterator, {
        value: function* () {
          iterations++;
          result.private = context.local;
          yield ['x-public', 'value'];
        },
      });
      expect(() => createDataResponse(outcome, identity, expected)).toThrow(
        /Request-private context/,
      );
      expect(iterations).toBe(1);
    }
  });

  it('refreshes private aliases added after the critical shell for every deferred settlement', async () => {
    const context: { locals: { late?: object } } = { locals: {} };
    const work = pending();
    const outcome = await invokeRouteData(
      () => deferData({ public: 'critical' }, { later: work.promise }),
      requestInput(context),
    );
    const response = createDataResponse(outcome, identity, expected);
    const wire = response.clone().text();
    const decoded = await readDataResponse(response, expected);
    if (decoded.kind !== 'success')
      throw new Error('Expected deferred success');
    context.locals.late = { secret: 'late-context-private' };
    work.resolve({ nested: context.locals.late });
    await expect(
      (decoded.value as { later: Promise<unknown> }).later,
    ).rejects.toThrow('Unexpected Server Error');
    await decoded.completion;
    expect(await wire).not.toContain('late-context-private');
  });

  it('blocks private thrown errors and deferred rejections before development projection', async () => {
    let reads = 0;
    const error = Object.defineProperty(new Error(), 'message', {
      get() {
        reads++;
        return 'private-error-message';
      },
    });
    const context = { error };
    await expect(
      invokeRouteData(
        () => {
          throw error;
        },
        requestInput(context),
        { production: false },
      ),
    ).rejects.toThrow(/Request-private context/);
    const work = pending();
    const outcome = await invokeRouteData(
      () => deferData({}, { later: work.promise }),
      requestInput(context),
      { production: false },
    );
    const response = createDataResponse(outcome, identity, {
      ...expected,
      production: false,
    });
    const wire = response.clone().text();
    const decoded = await readDataResponse(response, expected);
    if (decoded.kind !== 'success')
      throw new Error('Expected deferred success');
    work.reject(error);
    await expect(
      (decoded.value as { later: Promise<unknown> }).later,
    ).rejects.toThrow(/Request-private context/);
    await decoded.completion;
    expect(await wire).not.toContain('private-error-message');
    expect(reads).toBe(0);
  });

  it('rechecks rejected errors that become private before deferred projection', async () => {
    const context: { error?: Error } = {};
    const work = pending();
    const error = new Error('late-private-error-secret');
    work.reject(error);
    const outcome = await invokeRouteData(
      () => deferData({}, { later: work.promise }),
      requestInput(context),
      { production: false },
    );
    context.error = error;
    const response = createDataResponse(outcome, identity, {
      ...expected,
      production: false,
    });
    const wire = response.clone().text();
    const decoded = await readDataResponse(response, expected);
    if (decoded.kind !== 'success')
      throw new Error('Expected deferred success');
    await expect(
      (decoded.value as { later: Promise<unknown> }).later,
    ).rejects.toThrow(/Request-private context/);
    await decoded.completion;
    expect(await wire).not.toContain('late-private-error-secret');
  });
});
