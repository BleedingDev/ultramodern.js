import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, test } from 'node:test';
import {
  assetConsumerRecipes,
  assetConsumers,
  verifyAssetConsumer,
} from './asset-consumers.mjs';
import { assertRecipeConsumers } from './verify-sidecars.mjs';

const [contract] = assetConsumers;
const source = JSON.parse(
  fs.readFileSync(
    new URL(`../../${contract.source.importer}/package.json`, import.meta.url),
    'utf8',
  ),
);
const published = { ...source, name: contract.source.published };
const recipes = JSON.parse(
  fs.readFileSync(new URL('./sidecars.json', import.meta.url), 'utf8'),
);
const recipe = recipes.find(item => item.id === contract.recipe);
let bytes;

before(async () => {
  const response = await fetch(contract.artifact.tarball, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok);
  bytes = Buffer.from(await response.arrayBuffer());
});
const fetchImpl = async (url, options) => {
  assert.equal(url, contract.artifact.tarball);
  assert.ok(options.signal instanceof AbortSignal);
  return new Response(bytes);
};

test('actual authenticated Octane asset and source peer prove only its exact current core dependency', async () => {
  const proof = await verifyAssetConsumer(contract, { fetchImpl });
  assertRecipeConsumers([recipe], {
    generatorPins: [],
    publishedManifests: [published],
    assetProofs: [proof],
  });
  assert.deepEqual(assetConsumerRecipes([recipe], [published], [proof]), [
    recipe,
  ]);
  assert.ok(Object.isFrozen(proof));
  assert.throws(
    () => assetConsumerRecipes([recipe], [published], [{}]),
    /not authenticated/,
  );
  assert.throws(
    () => assetConsumerRecipes([recipe], [], [proof]),
    /absent from the cohort/,
  );
  assert.throws(
    () =>
      assetConsumerRecipes(
        [recipe],
        [
          {
            ...published,
            peerDependencies: {
              ...published.peerDependencies,
              [contract.consumer.name]: '^0.1.60',
            },
          },
        ],
        [proof],
      ),
    /Published asset peer identity differs/,
  );
  assert.throws(
    () =>
      assetConsumerRecipes(
        [{ ...recipe, upstream: { ...recipe.upstream, version: '1.171.34' } }],
        [published],
        [proof],
      ),
    /Asset recipe version differs/,
  );
});

test('asset evidence rejects byte, package, dependency key and exact specifier drift', async () => {
  for (const [change, message] of [
    [
      row => {
        row.artifact.integrity = `sha512-${'A'.repeat(86)}==`;
      },
      /Asset tarball integrity differs/,
    ],
    [
      row => {
        row.consumer.name = '@octanejs/wrong-router';
      },
      /Asset package name differs/,
    ],
    [
      row => {
        row.consumer.version = '0.1.60+wrong';
      },
      /Asset package version differs/,
    ],
    [
      row => {
        row.dependency.name = '@tanstack/wrong-core';
      },
      /Asset dependency key or exact specifier differs/,
    ],
    [
      row => {
        row.dependency.specifier = '^1.171.15';
      },
      /Asset dependency key or exact specifier differs/,
    ],
  ]) {
    const row = structuredClone(contract);
    change(row);
    const sourceManifest = {
      ...source,
      peerDependencies: { [row.consumer.name]: row.consumer.version },
      devDependencies: { [row.consumer.name]: row.artifact.tarball },
    };
    await assert.rejects(
      () => verifyAssetConsumer(row, { fetchImpl, sourceManifest }),
      message,
    );
  }
});

test('source pins and published asset URL must retain the authenticated current release', async () => {
  for (const [sourceManifest, message] of [
    [
      { ...source, name: '@modern-js/wrong-renderer' },
      /Asset source package name differs/,
    ],
    [
      { ...source, peerDependencies: { [contract.consumer.name]: '^0.1.60' } },
      /Asset source peer identity differs/,
    ],
    [
      {
        ...source,
        devDependencies: {
          [contract.consumer.name]:
            'https://github.com/bleedingdev/octane/releases/download/wrong.tgz',
        },
      },
      /Asset source URL differs/,
    ],
  ])
    await assert.rejects(
      () => verifyAssetConsumer(contract, { fetchImpl, sourceManifest }),
      message,
    );
  const proof = await verifyAssetConsumer(contract, { fetchImpl });
  assert.throws(
    () =>
      assetConsumerRecipes(
        [recipe],
        [{ ...published, devDependencies: {} }],
        [proof],
      ),
    /Published asset source URL differs/,
  );
  const row = structuredClone(contract);
  const stable = await verifyAssetConsumer(row, { fetchImpl });
  row.recipe = 'tanstack-router-core';
  row.dependency.specifier = '1.171.34';
  assert.deepEqual(assetConsumerRecipes([recipe], [published], [stable]), [
    recipe,
  ]);
});
