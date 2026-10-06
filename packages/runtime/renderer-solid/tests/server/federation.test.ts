import { renderToStream, ssr } from '@solidjs/web';
import { createComponent } from 'solid-js';
import { federatedComponent } from '../../src/federation';
import {
  FEDERATION_SSR,
  type FederationSSRState,
  withFederatedAssets,
} from '../../src/federation-ssr';

const HOST_INSTANCE = Symbol.for('ultramodern.federation.host-instance');
const globals = globalThis as Record<symbol, unknown>;

function installHost(loadRemote: (id: string) => Promise<unknown>) {
  const state: FederationSSRState = {
    hydrationModule: 'static/js/federation-hydration.test.js',
    assets: new Map(),
  };
  globals[FEDERATION_SSR] = state;
  globals[HOST_INSTANCE] = {
    loadRemote,
    remoteHandler: {
      idToRemoteMap: {
        'remote/Widget': { name: 'remote', expose: './Widget' },
      },
    },
    moduleCache: new Map([['remote', { remoteInfo: { name: 'remote' } }]]),
    snapshotHandler: {
      getGlobalRemoteInfo: () => ({
        remoteSnapshot: {
          publicPath: 'http://remote.test/',
          remoteEntry: 'remoteEntry.js',
          modules: [
            {
              modulePath: './Widget',
              assets: {
                js: { sync: ['static/js/widget.js'] },
                css: { sync: ['static/css/widget.css'], async: [] },
              },
            },
          ],
        },
      }),
    },
  };
  return state;
}

const render = (view: () => unknown) =>
  Promise.resolve(
    renderToStream(view as never, {
      manifest: withFederatedAssets({ _base: '/' }),
    }) as unknown as PromiseLike<string>,
  );

const fallback = () => ssr(['<span data-fallback="">loading</span>']);
const document = (child: () => unknown) => () =>
  ssr(['<html><head></head><body>', '</body></html>'], child() as never);

afterEach(() => {
  delete globals[FEDERATION_SSR];
  delete globals[HOST_INSTANCE];
});

describe('federated Solid components on the server', () => {
  test('render the remote with its stylesheet and hydration module', async () => {
    const state = installHost(async () => ({
      default: (props: { label: string }) =>
        ssr(['<b data-remote="">', '</b>'], props.label),
    }));
    const Widget = federatedComponent<{ label: string }>('remote/Widget', {
      fallback,
    });
    const html = await render(
      document(() => createComponent(Widget, { label: 'from host' })),
    );
    // The shell waits for the remote: its markup is inline, not a deferred fragment.
    expect(html).toContain('<b data-remote="">from host</b>');
    expect(html).not.toContain('<template');
    expect(html).not.toContain('data-fallback');
    expect(html).toMatch(
      /<link[^>]+rel="stylesheet"[^>]+href="http:\/\/remote\.test\/static\/css\/widget\.css"|<link[^>]+href="http:\/\/remote\.test\/static\/css\/widget\.css"[^>]+rel="stylesheet"/u,
    );
    expect(html).toContain('http://remote.test/remoteEntry.js');
    expect(html).toContain('http://remote.test/static/js/widget.js');
    expect(html).toContain(
      '/static/js/federation-hydration.test.js?id=remote%2FWidget',
    );
    expect([...state.assets.keys()]).toEqual([
      'ultramodern-federation:remote/Widget',
    ]);
  });

  test('render the fallback when the remote fails on the server', async () => {
    const state = installHost(() =>
      Promise.reject(new Error('remote offline')),
    );
    const Widget = federatedComponent('remote/Widget', { fallback });
    const html = await render(document(() => createComponent(Widget, {})));
    expect(html).toContain('data-fallback');
    expect(html).not.toContain('federation-hydration');
    expect(state.assets.size).toBe(0);
  });

  test('a remote that exceeds its timeout renders the fallback in time', async () => {
    installHost(() => new Promise(() => {}));
    const Widget = federatedComponent('remote/Widget', {
      fallback,
      timeout: 50,
    });
    const started = Date.now();
    const html = await render(document(() => createComponent(Widget, {})));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(html).toContain('data-fallback');
  });

  test('custom loaders render in the browser only', async () => {
    installHost(async () => ({ default: () => 'remote' }));
    const load = rstest.fn(() => Promise.resolve({ default: () => 'remote' }));
    const Widget = federatedComponent(load, { fallback });
    const html = await render(document(() => createComponent(Widget, {})));
    expect(html).toContain('data-fallback');
    expect(load).not.toHaveBeenCalled();
  });

  test('render nothing without a fallback when the remote fails', async () => {
    const Widget = federatedComponent('remote/Widget');
    const html = await render(document(() => createComponent(Widget, {})));
    expect(html).toMatch(/<body>(?:<!--[^>]*-->)*<\/body>/u);
  });
});
