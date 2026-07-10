const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '../../..');
const receiptCliPath = path.resolve(
  __dirname,
  '../published-create-proof/acceptance-receipt.mjs',
);

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

async function createReceiptFixture(root) {
  const {
    bindSupplyChainEvidence,
    createAcceptanceReceipt,
    finalizeAcceptanceReceipt,
    recordAcceptanceResult,
    requiredAcceptanceResultIds,
  } = await import(pathToFileURL(receiptCliPath));
  const release = {
    source: {
      commit: '1'.repeat(40),
      repository: 'BleedingDev/ultramodern.js',
    },
    release: { tag: 'latest', version: '3.4.0-ultramodern.2' },
    manifestSha256: digest('release manifest'),
    cohortDigest: digest('release cohort'),
    packages: [{ targetName: '@bleedingdev/modern-js-create' }],
    createPackage: {
      sourceName: '@modern-js/create',
      targetName: '@bleedingdev/modern-js-create',
      version: '3.4.0-ultramodern.2',
      integrity: 'sha512-create',
    },
  };
  const runIdentity = 'github:BleedingDev/ultramodern.js:run:123:attempt:1';
  const receipt = createAcceptanceReceipt({
    release,
    mode: 'source',
    profile: { id: 'erp-10', verticalCount: 10 },
    createPackage: {
      packageName: release.createPackage.targetName,
      version: release.createPackage.version,
      exactSpecifier: `${release.createPackage.targetName}@${release.createPackage.version}`,
    },
    runtime: {
      arch: 'x64',
      node: '24.0.0',
      npm: '11.0.0',
      platform: 'linux',
      playwright: '1.60.0',
      pnpm: '10.0.0',
      registry: { name: 'npm', version: '11.0.0', integrity: 'sha512-npm' },
      yaml: { name: 'yaml', version: '2.0.0', integrity: 'sha512-yaml' },
    },
    registry: {
      cohortPackages: 'verified',
      externalDependencies: 'verified',
      resolution: 'verified',
      url: 'https://registry.npmjs.org/',
    },
    runIdentity,
  });
  bindSupplyChainEvidence(receipt, {
    closureSha256: digest('closure'),
    exceptionPolicySha256: digest('exceptions'),
    lockSha256: digest('lock'),
    registryMetadataSha256: digest('registry'),
    releaseManifestSha256: release.manifestSha256,
  });
  for (const id of requiredAcceptanceResultIds) {
    await recordAcceptanceResult(receipt, id, async () => ({ id }));
  }
  finalizeAcceptanceReceipt(receipt);

  const manifest = {
    aliases: {},
    cohortDigest: release.cohortDigest,
    dependencyGraph: {},
    packages: release.packages,
    publishOrder: [],
    release: release.release,
    schema: 'bleedingdev.ultramodern.release-manifest',
    schemaVersion: 2,
    source: release.source,
    tools: {},
  };
  const manifestPath = path.join(root, 'manifest.json');
  const receiptPath = path.join(root, 'acceptance-receipt.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  receipt.binding.manifest.sha256 = digest(fs.readFileSync(manifestPath));
  receipt.binding.supplyChain.releaseManifestSha256 =
    receipt.binding.manifest.sha256;
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    manifestPath,
    receiptPath,
    receiptSource: fs.readFileSync(receiptPath, 'utf8'),
    runIdentity,
  };
}

function verifyReceipt({ manifestPath, receiptPath, runIdentity }) {
  return spawnSync(
    process.execPath,
    [
      receiptCliPath,
      '--verify',
      '--manifest',
      manifestPath,
      '--receipt',
      receiptPath,
      '--run-identity',
      runIdentity,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
}

test('producer receipt passes the shared workflow receipt validator', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-receipt-'));
  try {
    const fixture = await createReceiptFixture(root);
    const valid = verifyReceipt(fixture);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.match(valid.stdout, /Verified ERP-10 acceptance receipt/);

    for (const [name, mutate, message] of [
      [
        'stale schema version',
        receipt => {
          receipt.schemaVersion = 1;
        },
        /Unknown acceptance receipt schema/,
      ],
      [
        'unknown profile version',
        receipt => {
          receipt.profile.version = 999;
          receipt.binding.profile.version = 999;
        },
        /ERP-10 profile identity is invalid/,
      ],
      [
        'manifest identity drift',
        receipt => {
          receipt.binding.manifest.cohortDigest = 'f'.repeat(64);
        },
        /does not match the release manifest identity/,
      ],
    ]) {
      const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
      mutate(receipt);
      fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt)}\n`);
      const result = verifyReceipt(fixture);
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, message, name);
      fs.writeFileSync(fixture.receiptPath, fixture.receiptSource);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
