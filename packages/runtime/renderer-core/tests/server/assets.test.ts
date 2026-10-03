import { type RendererIdentity } from '../../src/identity';
import { validateNativeClientAssetManifest } from '../../src/server';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'asset-app',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'asset-build',
};
const manifest = () => ({
  schema: 'ultramodern-renderer-assets',
  version: 1,
  renderer: 'solid',
  entries: {
    main: {
      rendererIdentity: identity,
      assets: [
        { kind: 'stylesheet', href: '/actual-hash/style.css' },
        { kind: 'script', href: '/actual-hash/main.mjs' },
      ],
    },
  },
});

describe('native initial asset manifest', () => {
  it('validates immutable entry identity and preserves actual emitted order', () => {
    const assets = validateNativeClientAssetManifest(manifest(), identity);
    expect(assets).toEqual(manifest().entries.main.assets);
    expect(Object.isFrozen(assets)).toBe(true);
  });
  it('rejects stale hydration build assets', () => {
    expect(() =>
      validateNativeClientAssetManifest(manifest(), {
        ...identity,
        buildId: 'different',
      }),
    ).toThrow('Renderer identity conflicts');
  });
  it('rejects wrong renderer, schema and missing entry', () => {
    expect(() =>
      validateNativeClientAssetManifest(
        { ...manifest(), renderer: 'octane' },
        identity,
      ),
    ).toThrow('selected renderer or schema');
    expect(() =>
      validateNativeClientAssetManifest(
        { ...manifest(), version: 2 },
        identity,
      ),
    ).toThrow('selected renderer or schema');
    expect(() =>
      validateNativeClientAssetManifest(manifest(), {
        ...identity,
        entryName: 'admin',
      }),
    ).toThrow('missing entry admin');
  });
  it('rejects absence, invalid asset URLs and manifests without an app script', () => {
    expect(() => validateNativeClientAssetManifest(null, identity)).toThrow(
      'Rebuild',
    );
    const invalid = manifest();
    invalid.entries.main.assets[1].href = 'javascript:alert(1)';
    expect(() => validateNativeClientAssetManifest(invalid, identity)).toThrow(
      'HTTP URL',
    );
    const noScript = manifest();
    noScript.entries.main.assets = noScript.entries.main.assets.filter(
      asset => asset.kind !== 'script',
    );
    expect(() => validateNativeClientAssetManifest(noScript, identity)).toThrow(
      'no application script',
    );
  });
});
