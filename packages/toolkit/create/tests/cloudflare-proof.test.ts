import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = path.resolve(__dirname, '..');

type CloudflareProofModule = {
  resolveModuleFederationPublicPath: (
    publicPath: unknown,
    manifestUrl: URL,
  ) => string | undefined;
};

async function loadCloudflareProofModule() {
  return (await import(
    pathToFileURL(
      path.join(
        packageRoot,
        'templates/workspace-scripts/ultramodern-cloudflare-proof.mjs',
      ),
    ).href
  )) as CloudflareProofModule;
}

test('Cloudflare proof resolves MF publicPath values against the manifest URL', async () => {
  const { resolveModuleFederationPublicPath } =
    await loadCloudflareProofModule();
  const manifestUrl = new URL(
    'https://checkout.example.workers.dev/mf-manifest.json',
  );
  const expectedManifestBase = new URL('.', manifestUrl).toString();

  assert.equal(
    resolveModuleFederationPublicPath('/', manifestUrl),
    expectedManifestBase,
  );
  assert.equal(
    resolveModuleFederationPublicPath('./', manifestUrl),
    expectedManifestBase,
  );
  assert.equal(
    resolveModuleFederationPublicPath(
      'https://checkout.example.workers.dev/',
      manifestUrl,
    ),
    expectedManifestBase,
  );
  assert.equal(
    resolveModuleFederationPublicPath('assets/', manifestUrl),
    'https://checkout.example.workers.dev/assets/',
  );
  assert.notEqual(
    resolveModuleFederationPublicPath(
      'https://wrong-origin.example.com/',
      manifestUrl,
    ),
    expectedManifestBase,
  );
  assert.equal(resolveModuleFederationPublicPath('', manifestUrl), undefined);
  assert.equal(
    resolveModuleFederationPublicPath(undefined, manifestUrl),
    undefined,
  );
});
