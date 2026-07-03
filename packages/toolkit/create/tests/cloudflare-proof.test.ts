import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('Cloudflare proof template asserts delivery-unit marker coupling on UI and API surfaces', () => {
  const proofTemplate = fs.readFileSync(
    path.join(
      packageRoot,
      'templates/workspace-scripts/ultramodern-cloudflare-proof.mjs',
    ),
    'utf-8',
  );

  assert.match(proofTemplate, /type: 'delivery-unit-ui-marker'/);
  assert.match(proofTemplate, /type: 'delivery-unit-api-marker'/);
  assert.match(
    proofTemplate,
    /is declared but SSR response is missing its build marker/,
  );
  assert.match(
    proofTemplate,
    /is declared but readiness response is missing its build marker/,
  );
});

test('Cloudflare version proof synthesizes a delivery-unit block per API app', () => {
  const generatorTemplate = fs.readFileSync(
    path.join(
      packageRoot,
      'templates/workspace-scripts/proof-cloudflare-version.mjs',
    ),
    'utf-8',
  );

  assert.match(generatorTemplate, /function createDeliveryUnit\(/);
  assert.match(generatorTemplate, /kind: 'microvertical-delivery-unit'/);
  assert.match(
    generatorTemplate,
    /surfaces: \{\s*ui: \{ \.\.\.identity, surface: 'ui' \},\s*api: \{ \.\.\.identity, surface: 'api' \},/,
  );
});
