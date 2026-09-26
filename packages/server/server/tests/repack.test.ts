import { createRequire } from 'node:module';
import path from 'node:path';
import { fileReader } from '@modern-js/runtime-utils/fileReader';
import { onRepack } from '../src/helpers/repack';

const nodeRequire = createRequire(__filename);
const distDir = path.join(__dirname, 'fixtures/federated-ssr');
const bundlePath = path.join(distDir, 'bundles/index.js');
const hooks = { onReset: { call: rstest.fn() } } as any;

// The dev server loads SSR bundles through Node's CommonJS loader and
// `onRepack` evicts them from `require.cache`. Under rstest that identifier is
// the runner's module registry, so evict the bundle from Node's cache here.
const requireBundleGeneration = () => {
  delete nodeRequire.cache[bundlePath];
  return nodeRequire(bundlePath);
};

afterEach(async () => {
  await onRepack(distDir, hooks);
});

describe('onRepack', () => {
  it('lets a re-required federated SSR bundle consume its own shared singletons', async () => {
    const previous = requireBundleGeneration();
    expect(previous.loadReact()).toBe(previous.react);

    await onRepack(distDir, hooks);
    const next = requireBundleGeneration();

    expect(next.loadReact()).toBe(next.react);
  });

  it('purges the previous generation only after a slow async onReset handler settles', async () => {
    let releaseReset!: () => void;
    const slowHooks = {
      onReset: {
        call: () =>
          new Promise<void>(resolve => {
            releaseReset = resolve;
          }),
      },
    } as any;
    const reset = rstest.spyOn(fileReader, 'reset');
    try {
      const repack = onRepack(distDir, slowHooks);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(reset).not.toHaveBeenCalled();

      releaseReset();
      await repack;
      expect(reset).toHaveBeenCalledTimes(1);
    } finally {
      reset.mockRestore();
    }
  });

  it('purges the previous generation and rejects when an onReset handler throws', async () => {
    const error = new Error('reset failed');
    const failingHooks = {
      onReset: { call: async () => Promise.reject(error) },
    };
    const reset = rstest.spyOn(fileReader, 'reset');
    try {
      await expect(onRepack(distDir, failingHooks as any)).rejects.toBe(error);
      expect(reset).toHaveBeenCalledTimes(1);
    } finally {
      reset.mockRestore();
    }
  });
});
