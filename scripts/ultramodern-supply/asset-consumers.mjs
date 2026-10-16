// Consumer: recipe reachability through authenticated renderer release assets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectNpmTarball } from '../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const verifiedProofs = new WeakMap();
export const assetConsumers = JSON.parse(
  fs.readFileSync(new URL('./asset-consumers.json', import.meta.url), 'utf8'),
);

/** Prove a current upstream dependency, without claiming a corrected release. */
export async function verifyAssetConsumer(
  contract,
  { fetchImpl = globalThis.fetch, sourceManifest } = {},
) {
  contract = structuredClone(contract);
  assert.match(contract.source.importer, /^packages\/[\w/-]+$/u);
  assert.match(contract.artifact.tarball, /^https:\/\/github\.com\//u);
  assert.match(contract.artifact.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/u);
  assert.ok(
    ['dependencies', 'optionalDependencies', 'peerDependencies'].includes(
      contract.dependency.block,
    ),
  );
  const source =
    sourceManifest ??
    JSON.parse(
      fs.readFileSync(
        path.join(repository, contract.source.importer, 'package.json'),
        'utf8',
      ),
    );
  assert.equal(
    source.name,
    contract.source.name,
    'Asset source package name differs',
  );
  assert.equal(
    source.peerDependencies?.[contract.consumer.name],
    contract.consumer.version,
    'Asset source peer identity differs',
  );
  assert.equal(
    source.devDependencies?.[contract.consumer.name],
    contract.artifact.tarball,
    'Asset source URL differs',
  );
  const response = await fetchImpl(contract.artifact.tarball, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Asset fetch failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(
    `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    contract.artifact.integrity,
    'Asset tarball integrity differs',
  );
  const { packageJson } = inspectNpmTarball(bytes);
  assert.equal(
    packageJson.name,
    contract.consumer.name,
    'Asset package name differs',
  );
  assert.equal(
    packageJson.version,
    contract.consumer.version,
    'Asset package version differs',
  );
  assert.equal(
    packageJson[contract.dependency.block]?.[contract.dependency.name],
    contract.dependency.specifier,
    'Asset dependency key or exact specifier differs',
  );
  const proof = Object.freeze({});
  verifiedProofs.set(proof, contract);
  return proof;
}

export async function verifyRepositoryAssetConsumers() {
  return Promise.all(
    assetConsumers.map(contract => verifyAssetConsumer(contract)),
  );
}

export function assetConsumerRecipes(recipeList, publishedManifests, proofs) {
  const reached = [];
  for (const proof of proofs) {
    const contract = verifiedProofs.get(proof);
    assert.ok(contract, 'Asset consumer proof is not authenticated');
    const recipe = recipeList.find(item => item.id === contract.recipe);
    assert.ok(
      recipe,
      `Asset consumer names an absent recipe ${contract.recipe}`,
    );
    assert.equal(
      recipe.upstream.name,
      contract.dependency.name,
      'Asset recipe package differs',
    );
    assert.equal(
      recipe.upstream.version,
      contract.dependency.specifier,
      'Asset recipe version differs',
    );
    const source = publishedManifests.find(
      item => item.name === contract.source.published,
    );
    assert.ok(
      source,
      `Asset consumer is absent from the cohort: ${contract.source.published}`,
    );
    assert.equal(
      source.peerDependencies?.[contract.consumer.name],
      contract.consumer.version,
      'Published asset peer identity differs',
    );
    assert.equal(
      source.devDependencies?.[contract.consumer.name],
      contract.artifact.tarball,
      'Published asset source URL differs',
    );
    reached.push(recipe);
  }
  return reached;
}
