import assert from 'node:assert/strict';
import { CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS } from '@modern-js/app-tools-extensions/cloudflare-output-contract';
import {
  createVerticalDescriptor,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';
import { createNativeFederationArtifacts } from '../src/ultramodern-workspace/native-federation';
import { createCloudflareDeployContract } from '../src/ultramodern-workspace/policy';

for (const renderer of ['solid', 'octane'] as const) {
  test(`${renderer} Worker proof coordinates match the generated native routes and referenced exposes`, () => {
    const catalog = createVerticalDescriptor('catalog', 4101, {
      renderer,
      preset: 'ui-only',
    });
    const orders = createVerticalDescriptor('orders', 4102, {
      renderer,
      preset: 'ui-only',
    });
    orders.exposes = { './Widget': './src/components/orders-widget.tsx' };
    const unused = createVerticalDescriptor('unused', 4103, {
      renderer,
      preset: 'ui-only',
    });
    const host = {
      ...shellApp,
      renderer,
      verticalRefs: [catalog.id, orders.id],
    };
    const remotes = [catalog, orders, unused];
    const contract = createCloudflareDeployContract('@acme', host, remotes);
    assert.deepEqual(contract.routes, {
      ssr: '/',
      mfManifest: '/mf-manifest.json',
    });
    assert.deepEqual(contract.distributedSsrProofRoutes, [
      '/remotes',
      '/remotes/catalog',
    ]);
    assert.deepEqual(contract.compatibilityFlags, [
      ...CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS,
    ]);
    const sources = createNativeFederationArtifacts('@acme', host, remotes);
    assert.ok(Array.isArray(contract.distributedSsrProofRoutes));
    for (const route of contract.distributedSsrProofRoutes) {
      assert.ok(
        sources.some(source => source.path === `src/routes${route}/page.tsx`),
        `Worker proof route ${route} has no generated native source`,
      );
    }
    assert.ok(!sources.some(source => source.path.includes('/unused/')));
    const remote = createCloudflareDeployContract('@acme', catalog, remotes);
    assert.deepEqual(remote.routes, {
      ssr: '/',
      mfManifest: '/mf-manifest.json',
    });
    assert.equal(Object.hasOwn(remote, 'distributedSsrProofRoutes'), false);
  });
}

test('React Worker proof keeps its localized route and locale JSON contract', () => {
  const contract = createCloudflareDeployContract('@acme', shellApp);
  assert.deepEqual(contract.routes, {
    ssr: '/en',
    mfManifest: '/mf-manifest.json',
    locale: '/locales/en/shell.json',
  });
  assert.equal(Object.hasOwn(contract, 'distributedSsrProofRoutes'), false);
});
