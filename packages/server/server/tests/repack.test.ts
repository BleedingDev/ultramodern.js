import { createRequire } from 'node:module';
import path from 'node:path';
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

afterEach(() => {
  onRepack(distDir, hooks);
});

describe('onRepack', () => {
  it('lets a re-required federated SSR bundle consume its own shared singletons', () => {
    const previous = requireBundleGeneration();
    expect(previous.loadReact()).toBe(previous.react);

    onRepack(distDir, hooks);
    const next = requireBundleGeneration();

    expect(next.loadReact()).toBe(next.react);
  });
});
