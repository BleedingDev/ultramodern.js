const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  createOperationalAcceptanceReceiptFixture,
} = require('./support/operational-acceptance-fixture');

const repoRoot = path.resolve(__dirname, '../../..');
const receiptCliPath = path.resolve(
  __dirname,
  '../published-create-proof/acceptance-receipt.mjs',
);

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

async function createReceiptFixture(root) {
  const receiptApi = await import(pathToFileURL(receiptCliPath));
  const { bindSupplyChainEvidence, createAcceptanceReceipt } = receiptApi;
  const release = {
    source: {
      commit: '1'.repeat(40),
      repository: 'BleedingDev/ultramodern.js',
    },
    release: { tag: 'latest', version: '3.4.0-ultramodern.2' },
    manifestSha256: digest('release manifest'),
    cohortDigest: digest('release cohort'),
    packages: [
      {
        targetName: '@bleedingdev/modern-js-ultramodern-create',
        version: '3.4.0-ultramodern.2',
        integrity: 'sha512-create',
        packageJson: {
          dependencies: {
            '@module-federation/runtime': '2.8.0',
          },
        },
      },
    ],
    createPackage: {
      sourceName: '@modern-js/ultramodern-create',
      targetName: '@bleedingdev/modern-js-ultramodern-create',
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
  const operationalEvidence = await createOperationalAcceptanceReceiptFixture({
    evidencePath: path.join(
      root,
      'acceptance-receipt.operational-independence.json',
    ),
    overrides: {
      identity: {
        baselineRevision: '2'.repeat(40),
        changedRevision: '3'.repeat(40),
        releaseVersion: '0.1.0',
        runtimeReleaseVersion: '0.1.0',
        runtimeSourceRevision: '2'.repeat(40),
      },
    },
    receipt,
    receiptApi,
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  receipt.binding.manifest.sha256 = digest(fs.readFileSync(manifestPath));
  receipt.binding.supplyChain.releaseManifestSha256 =
    receipt.binding.manifest.sha256;
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    manifestPath,
    operationalEvidencePath: operationalEvidence.evidencePath,
    operationalEvidenceSource: operationalEvidence.evidenceSource,
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

function replaceOperationalEvidence(fixture, evidence) {
  const evidenceSource = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(fixture.operationalEvidencePath, evidenceSource);
}

test('producer receipt passes the shared workflow receipt validator', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-receipt-'));
  try {
    const fixture = await createReceiptFixture(root);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    const operationalDetails = receipt.results.find(
      result => result.id === 'operational-independence',
    ).details;
    assert.deepEqual(Object.keys(operationalDetails).sort(), [
      'artifactMode',
      'baselineRevision',
      'changedPaths',
      'changedRevision',
      'durationMs',
      'evidencePath',
      'mutations',
    ]);
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
      [
        'cross-platform MicroVertical delivery drift',
        receipt => {
          receipt.binding.runtimeIdentity.workerd[0].releaseVersion = '0.2.0';
        },
        /Node and workerd identities differ/,
      ],
      [
        'missing operational-independence result',
        receipt => {
          receipt.results = receipt.results.filter(
            result => result.id !== 'operational-independence',
          );
        },
        /every required result exactly once/,
      ],
      [
        'operational-independence artifact mode drift',
        receipt => {
          receipt.results.find(
            result => result.id === 'operational-independence',
          ).details.artifactMode = 'published';
        },
        /artifactMode must be source/,
      ],
      [
        'operational-independence mutation expectation drift',
        receipt => {
          const details = receipt.results.find(
            result => result.id === 'operational-independence',
          ).details;
          details.mutations.apiResponse.value = 'forged expected value';
        },
        /did not observe the exact C1 API and UI mutations/,
      ],
      [
        'operational-independence evidence path drift',
        receipt => {
          receipt.results.find(
            result => result.id === 'operational-independence',
          ).details.evidencePath = 'relative/evidence.json';
        },
        /evidence path is invalid/,
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

test('producer receipt verification fails closed when operational evidence is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-receipt-'));
  try {
    const fixture = await createReceiptFixture(root);

    fs.rmSync(fixture.operationalEvidencePath);
    const missing = verifyReceipt(fixture);
    assert.notEqual(missing.status, 0);
    assert.match(
      missing.stderr,
      /Operational-independence evidence is missing or is not a regular file/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('producer receipt verification fails closed when operational evidence is tampered', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-receipt-'));
  try {
    const fixture = await createReceiptFixture(root);
    fs.writeFileSync(
      fixture.operationalEvidencePath,
      fixture.operationalEvidenceSource.replace(
        '"result": "pass"',
        '"result": "fail"',
      ),
    );
    const tampered = verifyReceipt(fixture);
    assert.notEqual(tampered.status, 0);
    assert.match(
      tampered.stderr,
      /Operational-independence node served behavior is missing, degraded, skipped, or non-passing/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('producer receipt verification fails closed when operational evidence is swapped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-receipt-'));
  try {
    const fixture = await createReceiptFixture(root);
    const swapped = JSON.parse(fixture.operationalEvidenceSource);
    swapped.commits.changed = '4'.repeat(40);
    fs.writeFileSync(
      fixture.operationalEvidencePath,
      `${JSON.stringify(swapped, null, 2)}\n`,
    );
    const swappedResult = verifyReceipt(fixture);
    assert.notEqual(swappedResult.status, 0);
    assert.match(
      swappedResult.stderr,
      /Operational-independence commits are stale, mixed, or outside inventory ownership/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('producer receipt verification does not treat the evidence digest as correctness', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-receipt-'));
  try {
    const fixture = await createReceiptFixture(root);
    const evidence = JSON.parse(fixture.operationalEvidenceSource);
    evidence.evidenceDigest = 'administrative-digest-is-not-proof';
    replaceOperationalEvidence(fixture, evidence);

    const result = verifyReceipt(fixture);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('producer receipt verification binds operational evidence to the receipt C0 and C1 revisions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-receipt-'));
  try {
    const fixture = await createReceiptFixture(root);
    const evidence = JSON.parse(fixture.operationalEvidenceSource);
    evidence.commits.changed = '4'.repeat(40);
    replaceOperationalEvidence(fixture, evidence);

    const result = verifyReceipt(fixture);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Operational-independence commits are stale, mixed, or outside inventory ownership/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('producer receipt verification rechecks operational byte conservation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-receipt-'));
  try {
    const fixture = await createReceiptFixture(root);
    const evidence = JSON.parse(fixture.operationalEvidenceSource);
    evidence.targets.cloudflare.comparison.shell.byteIdentical = false;
    replaceOperationalEvidence(fixture, evidence);

    const result = verifyReceipt(fixture);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Operational-independence cloudflare comparison is incomplete or non-passing/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
