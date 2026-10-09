import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { startNativeClient } from '../../src/entry-client';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'entry-disposal',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'entry-disposal-build',
};

test('HMR disposal during the initial load cancels its pending route matches', async () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  let loading!: () => void;
  const started = new Promise<void>(resolve => {
    loading = resolve;
  });
  let loaderSignal: AbortSignal | undefined;
  let dispose: (() => void) | undefined;
  try {
    startNativeClient({
      identity,
      hot: { dispose: (callback: () => void) => (dispose = callback) },
      load: async () => ({
        basePath: '/',
        routeIR: [
          {
            id: 'home',
            index: true,
            modules: { data: '/home.data.ts' },
            children: [],
          },
        ],
        routeModules: { home: { component: { default: () => null } } },
        dataModules: {
          home: {
            // A loader that never settles on its own.
            loader: ({ request }: { request: Request }) => {
              loaderSignal = request.signal;
              loading();
              return new Promise(() => {});
            },
          },
        },
      }),
    });
    await started;
    expect(loaderSignal?.aborted).toBe(false);
    dispose!();
    expect(loaderSignal?.aborted).toBe(true);
  } finally {
    root.remove();
  }
});
