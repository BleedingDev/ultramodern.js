import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  createContext,
  createElement,
  ErrorBoundary,
  hookSlots,
  lazy,
  memo,
  Suspense,
  useContext,
  useState,
} from 'octane';
import { mountOctaneApplication } from '../src/client';
import { federatedComponent } from '../src/federation';

const identity: RendererIdentity = {
  renderer: 'octane',
  appId: 'federation-test',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'federation-build',
};

const waitFor = async (assertion: () => void) => {
  let failure: unknown;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw failure;
};

test('native Suspense shows the fallback and then the remote with host props and context', async () => {
  const Theme = createContext('missing');
  let resolve!: (module: {
    default: (props: { label: string }) => unknown;
  }) => void;
  const load = rstest.fn(
    () =>
      new Promise<{ default: (props: { label: string }) => unknown }>(done => {
        resolve = done;
      }),
  );
  const Widget = federatedComponent(load, {
    fallback: () => createElement('p', { 'data-pending': '' }, 'Loading'),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const application = await mountOctaneApplication({
    container,
    identity,
    nativeHydrationBuildId: 'native-build',
    load: async () => ({
      default: () =>
        createElement(Theme, {
          value: 'host theme',
          children: createElement(Widget, { label: 'host props' }),
        }),
    }),
  });
  try {
    await waitFor(() =>
      expect(container.querySelector('[data-pending]')).not.toBeNull(),
    );
    resolve({
      default: props =>
        createElement('button', null, `${props.label}: ${useContext(Theme)}`),
    });
    await waitFor(() =>
      expect(container.textContent).toBe('host props: host theme'),
    );
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    application.dispose();
    container.remove();
  }
});

test('two host bindings cannot share the same remote load cache', async () => {
  const Widget = federatedComponent('remote/Widget');
  const containers = ['first', 'second'].map(() =>
    document.createElement('div'),
  );
  const loads = ['first host', 'second host'].map(label =>
    rstest.fn(async () => ({
      default: () => createElement('button', null, label),
    })),
  );
  const handles = await Promise.all(
    containers.map((container, index) =>
      mountOctaneApplication({
        container,
        identity: { ...identity, appId: `host-${index}` },
        nativeHydrationBuildId: 'native-build',
        federation: { instance: () => ({ loadRemote: loads[index] }) },
        load: async () => ({ default: () => createElement(Widget) }),
      }),
    ),
  );
  try {
    await waitFor(() =>
      expect(containers.map(container => container.textContent)).toEqual([
        'first host',
        'second host',
      ]),
    );
    for (const load of loads)
      expect(load).toHaveBeenCalledExactlyOnceWith('remote/Widget');
  } finally {
    for (const handle of handles) handle.dispose();
  }
});

test('application updates preserve the loaded remote and its native state while changing props', async () => {
  const stateSlot = Symbol(hookSlots(1));
  const loadRemote = rstest.fn(async () => ({
    default: (props: { label: string }) => {
      const [count, update] = useState(0, stateSlot);
      return createElement(
        'button',
        { onClick: () => update(count + 1) },
        `${props.label}: ${count}`,
      );
    },
  }));
  const Widget = federatedComponent<{ label: string }>('remote/Widget');
  const App = (props: { label: string }) => createElement(Widget, props);
  const container = document.createElement('div');
  const handle = await mountOctaneApplication({
    container,
    identity,
    nativeHydrationBuildId: 'native-build',
    federation: { instance: () => ({ loadRemote }) },
    load: async () => ({ default: App, props: { label: 'first' } }),
  });
  try {
    await waitFor(() => expect(container.textContent).toBe('first: 0'));
    container.querySelector('button')!.click();
    await waitFor(() => expect(container.textContent).toBe('first: 1'));
    handle.update({ default: App, props: { label: 'updated' } });
    await waitFor(() => expect(container.textContent).toBe('updated: 1'));
    expect(loadRemote).toHaveBeenCalledTimes(1);
  } finally {
    handle.dispose();
  }
});

test('remote defaults and memo components retain ordinary native lazy behavior', async () => {
  const run = async (federated: boolean) => {
    const render = rstest.fn((props: { label?: string }) =>
      createElement('button', null, props.label),
    );
    const Remote = memo(
      Object.assign(render, { defaultProps: { label: 'native default' } }),
      (previous, incoming) => previous.label === incoming.label,
    );
    const Widget = federated
      ? federatedComponent<{ label?: string }>('remote/Widget')
      : lazy(async () => ({ default: Remote }));
    const App = (props: { label?: string; tick?: number }) => {
      const widget = createElement(Widget, { label: props.label });
      return federated ? widget : createElement(Suspense, { children: widget });
    };
    const container = document.createElement('div');
    const handle = await mountOctaneApplication({
      container,
      identity,
      nativeHydrationBuildId: 'native-build',
      ...(federated
        ? {
            federation: {
              instance: () => ({
                loadRemote: async () => ({ default: Remote }),
              }),
            },
          }
        : {}),
      load: async () => ({ default: App, props: { tick: 1 } }),
    });
    try {
      await waitFor(() => expect(container.textContent).toBe('native default'));
      const initial = render.mock.calls.length;
      handle.update({ default: App, props: { tick: 2 } });
      await new Promise(resolve => setTimeout(resolve, 20));
      const unchanged = render.mock.calls.length;
      expect(container.textContent).toBe('native default');
      handle.update({ default: App, props: { label: 'new props' } });
      await waitFor(() => expect(container.textContent).toBe('new props'));
      return [initial, unchanged, render.mock.calls.length];
    } finally {
      handle.dispose();
    }
  };
  expect(await run(true)).toEqual(await run(false));
});

test('a browser rejection reaches the native ErrorBoundary and a new application retries', async () => {
  const error = new Error('remote offline');
  const load = rstest.fn(() => Promise.reject(error));
  const Widget = federatedComponent(load);
  for (let run = 0; run < 2; run++) {
    const container = document.createElement('div');
    const failures: unknown[] = [];
    const application = await mountOctaneApplication({
      container,
      identity,
      nativeHydrationBuildId: 'native-build',
      load: async () => ({
        default: () =>
          createElement(ErrorBoundary, {
            fallback: caught => {
              failures.push(caught);
              return createElement('p', { 'data-error': '' }, String(caught));
            },
            children: createElement(Widget),
          }),
      }),
    });
    try {
      await waitFor(() =>
        expect(container.querySelector('[data-error]')?.textContent).toContain(
          'remote offline',
        ),
      );
      expect(failures).toContain(error);
    } finally {
      application.dispose();
    }
  }
  expect(load).toHaveBeenCalledTimes(2);
});

test('an invalid module and a missing host runtime reach the native ErrorBoundary', async () => {
  for (const [Widget, message] of [
    [federatedComponent('remote/Widget'), 'no Module Federation runtime'],
    [
      federatedComponent(async () => ({ default: 'invalid' }) as never),
      'must default-export a native component',
    ],
  ] as const) {
    const container = document.createElement('div');
    const application = await mountOctaneApplication({
      container,
      identity,
      nativeHydrationBuildId: 'native-build',
      load: async () => ({
        default: () =>
          createElement(ErrorBoundary, {
            fallback: error => createElement('p', null, String(error)),
            children: createElement(Widget),
          }),
      }),
    });
    try {
      await waitFor(() => expect(container.textContent).toContain(message));
    } finally {
      application.dispose();
    }
  }
});

test('aborting a pending remote releases its root and cannot render into its replacement', async () => {
  const Widget = federatedComponent('remote/Widget');
  let resolve!: (module: { default: () => unknown }) => void;
  const pending = new Promise<{ default: () => unknown }>(done => {
    resolve = done;
  });
  const container = document.createElement('div');
  const abort = new AbortController();
  const old = await mountOctaneApplication({
    container,
    identity,
    nativeHydrationBuildId: 'native-build',
    signal: abort.signal,
    federation: { instance: () => ({ loadRemote: () => pending }) },
    load: async () => ({ default: () => createElement(Widget) }),
  });
  abort.abort(new Error('application stopped'));
  await new Promise(resolve => queueMicrotask(resolve));
  const replacement = await mountOctaneApplication({
    container,
    identity,
    nativeHydrationBuildId: 'native-build',
    federation: {
      instance: () => ({
        loadRemote: async () => ({
          default: () => createElement('b', null, 'replacement'),
        }),
      }),
    },
    load: async () => ({ default: () => createElement(Widget) }),
  });
  try {
    resolve({ default: () => createElement('b', null, 'abandoned') });
    await waitFor(() => expect(container.textContent).toBe('replacement'));
    old.dispose();
    expect(container.textContent).toBe('replacement');
  } finally {
    replacement.dispose();
  }
});

test('captures the native host before an asynchronous application importer changes its binding', async () => {
  const Widget = federatedComponent('remote/Widget');
  const container = document.createElement('div');
  let current = {
    loadRemote: async () => ({
      default: () => createElement('b', null, 'selected host'),
    }),
  };
  const application = await mountOctaneApplication({
    container,
    identity,
    nativeHydrationBuildId: 'native-build',
    federation: { instance: () => current },
    load: async () => {
      await Promise.resolve();
      current = {
        loadRemote: async () => ({
          default: () => createElement('b', null, 'other host'),
        }),
      };
      return { default: () => createElement(Widget) };
    },
  });
  try {
    await waitFor(() => expect(container.textContent).toBe('selected host'));
  } finally {
    application.dispose();
  }
});

test('rejects invalid remote ids and nonpositive or infinite load limits', () => {
  expect(() => federatedComponent('Widget')).toThrow("'remote/Widget'");
  expect(() => federatedComponent(42 as never)).toThrow("'remote/Widget'");
  for (const timeout of [0, -1, Infinity, NaN]) {
    expect(() => federatedComponent('remote/Widget', { timeout })).toThrow(
      'positive number',
    );
  }
});
