const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const source = {
  commit: '1'.repeat(40),
  repository: 'BleedingDev/ultramodern.js',
};
const release = { tag: 'latest', version: '3.4.0-ultramodern.2' };
const runId = '123';
const producerRunAttempt = 1;
const publicationRunAttempt = 2;
const outcomeRunAttempt = 3;
const producerArtifactIdentity = `run-${runId}-attempt-${producerRunAttempt}`;
const producerRunIdentity = `github:${source.repository}:run:${runId}:attempt:${producerRunAttempt}`;

async function outcomeApi() {
  return import('../publish-outcome.mjs');
}

function createEvidenceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-outcome-'));
  const manifestPath = path.join(root, 'manifest.json');
  const manifestDigestPath = path.join(root, 'manifest.json.sha256');
  const cohortDigestPath = path.join(root, 'cohort.sha256');
  const receiptPath = path.join(root, 'acceptance-receipt.json');
  const operationalEvidencePath = path.join(
    root,
    'acceptance-receipt.operational-independence.json',
  );
  const publishedReceiptPath = path.join(
    root,
    'published-acceptance-receipt.json',
  );
  const publishedOperationalEvidencePath = path.join(
    root,
    'published-acceptance-receipt.operational-independence.json',
  );
  const tractorReportPath = path.join(
    root,
    'tractor-downstream-acceptance.json',
  );
  const outPath = path.join(root, 'publish-outcome.json');
  const cohortDigest = digest('release cohort');
  const manifest = {
    aliases: {
      '@modern-js/create': '@bleedingdev/modern-js-create',
    },
    cohortDigest,
    cohortProjection: { sha256: digest('cohort projection') },
    dependencyGraph: {
      '@bleedingdev/modern-js-create': [],
    },
    packages: [
      {
        sourceName: '@modern-js/create',
        targetName: '@bleedingdev/modern-js-create',
        version: release.version,
      },
    ],
    publishOrder: ['@bleedingdev/modern-js-create'],
    release,
    schema: 'bleedingdev.ultramodern.release-manifest',
    schemaVersion: 2,
    source,
    tools: { node: '24.0.0', npm: '11.0.0', pnpm: '10.0.0' },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    manifestDigestPath,
    `${digest(fs.readFileSync(manifestPath))}  manifest.json\n`,
  );
  fs.writeFileSync(cohortDigestPath, `${cohortDigest}\n`);
  const manifestSha256 = digest(fs.readFileSync(manifestPath));
  const acceptanceReceipt = mode => ({
    binding: {
      manifest: { cohortDigest, sha256: manifestSha256 },
      runIdentity: producerRunIdentity,
    },
    mode,
    passed: true,
    status: 'passed',
  });
  fs.writeFileSync(
    receiptPath,
    `${JSON.stringify(acceptanceReceipt('source'))}\n`,
  );
  fs.writeFileSync(
    operationalEvidencePath,
    `${JSON.stringify({ status: 'passed' })}\n`,
  );
  fs.writeFileSync(
    publishedReceiptPath,
    `${JSON.stringify(acceptanceReceipt('published'))}\n`,
  );
  fs.writeFileSync(
    publishedOperationalEvidencePath,
    `${JSON.stringify({ status: 'passed' })}\n`,
  );
  const tractorBaselineRevision = '2'.repeat(40);
  const uiSha256 = digest('tractor visible ui');
  fs.writeFileSync(
    tractorReportPath,
    `${JSON.stringify({
      checks: [
        {
          detail: { fileCount: 10, sha256: uiSha256 },
          id: 'ui-baseline',
          status: 'passed',
        },
        {
          detail: { resultCount: 3, status: 'pass' },
          id: 'node-backend-federation-executed',
          status: 'passed',
        },
        {
          detail: { assertionCount: 5, platform: 'node' },
          id: 'node-visible-tractor-workflow',
          status: 'passed',
        },
        {
          detail: { assertionCount: 5, platform: 'workerd' },
          id: 'workerd-visible-tractor-workflow',
          status: 'passed',
        },
        {
          detail: {
            fileCount: 10,
            sha256: uiSha256,
            status: 'unchanged',
          },
          id: 'final-visible-ui-source',
          status: 'passed',
        },
      ],
      release: {
        cohortDigest,
        manifestSha256,
        sourceRevision: source.commit,
        version: release.version,
      },
      schema: 'bleedingdev.ultramodern.tractor-downstream-acceptance',
      schemaVersion: 1,
      status: 'passed',
      tractor: { baselineRevision: tractorBaselineRevision },
    })}\n`,
  );
  return {
    cohortDigestPath,
    manifestDigestPath,
    manifestPath,
    operationalEvidencePath,
    outPath,
    publishedOperationalEvidencePath,
    publishedReceiptPath,
    receiptPath,
    root,
    tractorBaselineRevision,
    tractorReportPath,
    tractorReportSha256: digest(fs.readFileSync(tractorReportPath)),
  };
}

function createOptions(fixture, artifactName, dryRun) {
  const options = {
    ...fixture,
    artifactName,
    dryRun,
    producerArtifactIdentity,
    publicationRunAttempt,
    producerRunAttempt,
    producerRunIdentity,
    repository: source.repository,
    runAttempt: outcomeRunAttempt,
    runId,
    sourceCommit: source.commit,
    tag: release.tag,
    version: release.version,
  };
  if (dryRun) {
    delete options.publishedOperationalEvidencePath;
    delete options.publishedReceiptPath;
    delete options.tractorBaselineRevision;
    delete options.tractorReportPath;
    delete options.tractorReportSha256;
  }
  return options;
}

function verificationOptions(fixture, artifactName) {
  return {
    artifactName,
    cohortDigestPath: fixture.cohortDigestPath,
    manifestDigestPath: fixture.manifestDigestPath,
    manifestPath: fixture.manifestPath,
    operationalEvidencePath: fixture.operationalEvidencePath,
    publishedOperationalEvidencePath: fixture.publishedOperationalEvidencePath,
    publishedReceiptPath: fixture.publishedReceiptPath,
    receiptPath: fixture.receiptPath,
    repository: source.repository,
    runAttempt: outcomeRunAttempt,
    runId,
    sourceCommit: source.commit,
    tractorReportPath: fixture.tractorReportPath,
  };
}

function artifact(id, name, overrides = {}) {
  return {
    created_at: '2026-07-10T10:00:00Z',
    expired: false,
    id,
    name,
    ...overrides,
  };
}

test('dry-run and real publication emit the same strict bound outcome schema', async () => {
  const api = await outcomeApi();
  const artifactName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });

  for (const dryRun of [true, false]) {
    const fixture = createEvidenceFixture();
    try {
      const outcome = api.createPublishOutcome(
        createOptions(fixture, artifactName, dryRun),
      );
      assert.equal(outcome.schema, api.publishOutcomeSchema);
      assert.equal(outcome.schemaVersion, api.publishOutcomeSchemaVersion);
      assert.equal(outcome.artifactName, artifactName);
      assert.equal(outcome.dryRun, dryRun);
      assert.deepEqual(outcome.source, source);
      assert.deepEqual(outcome.release, release);
      assert.deepEqual(outcome.workflowRun, {
        attempt: outcomeRunAttempt,
        id: runId,
      });
      assert.deepEqual(
        outcome.publication,
        dryRun ? null : { runAttempt: publicationRunAttempt },
      );
      assert.deepEqual(outcome.producer, {
        artifactIdentity: producerArtifactIdentity,
        runAttempt: producerRunAttempt,
        runIdentity: producerRunIdentity,
      });
      assert.deepEqual(
        api.assertPublishOutcome(
          JSON.parse(fs.readFileSync(fixture.outPath, 'utf8')),
          verificationOptions(fixture, artifactName),
        ),
        outcome,
      );
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  }
});

test('dry-run verification omits publication identity without emitting an empty GitHub output', async () => {
  const api = await outcomeApi();
  const artifactName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const fixture = createEvidenceFixture();
  const githubOutput = path.join(fixture.root, 'github-output.txt');
  try {
    api.createPublishOutcome(createOptions(fixture, artifactName, true));
    assert.equal(
      await api.main([
        'verify',
        '--outcome',
        fixture.outPath,
        '--artifact-name',
        artifactName,
        '--manifest',
        fixture.manifestPath,
        '--manifest-digest',
        fixture.manifestDigestPath,
        '--cohort-digest',
        fixture.cohortDigestPath,
        '--receipt',
        fixture.receiptPath,
        '--operational-evidence',
        fixture.operationalEvidencePath,
        '--repository',
        source.repository,
        '--source-commit',
        source.commit,
        '--run-id',
        runId,
        '--run-attempt',
        String(outcomeRunAttempt),
        '--github-output',
        githubOutput,
      ]),
      0,
    );
    const outputs = fs.readFileSync(githubOutput, 'utf8');
    assert.match(outputs, /dry_run=true/u);
    assert.doesNotMatch(outputs, /publication_run_attempt/u);
  } finally {
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('publish outcome rejects malformed and mismatched source, version, and run identity', async () => {
  const api = await outcomeApi();
  const artifactName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const fixture = createEvidenceFixture();
  try {
    const outcome = api.createPublishOutcome(
      createOptions(fixture, artifactName, false),
    );
    const cases = [
      [
        'schema',
        value => {
          value.schemaVersion = 5;
        },
        /Unknown publish outcome schema/u,
      ],
      [
        'publication attempt after outcome',
        value => {
          value.publication.runAttempt = outcomeRunAttempt + 1;
        },
        /publication run attempt follows the outcome attempt/u,
      ],
      [
        'source',
        value => {
          value.source.commit = '2'.repeat(40);
        },
        /does not match the triggering workflow run/u,
      ],
      [
        'version',
        value => {
          value.release.version = '3.4.0-ultramodern.3';
        },
        /Release manifest does not match/u,
      ],
      [
        'producer identity',
        value => {
          value.producer.runIdentity = `github:${source.repository}:run:${runId}:attempt:2`;
        },
        /Producer run identity/u,
      ],
      [
        'Tractor report digest',
        value => {
          value.evidence.tractorAcceptance.reportSha256 = 'a'.repeat(64);
        },
        /Tractor acceptance report SHA-256/u,
      ],
      [
        'unknown field',
        value => {
          value.untrusted = true;
        },
        /unknown or missing fields/u,
      ],
    ];
    for (const [label, mutate, pattern] of cases) {
      const changed = structuredClone(outcome);
      mutate(changed);
      assert.throws(
        () =>
          api.assertPublishOutcome(
            changed,
            verificationOptions(fixture, artifactName),
          ),
        pattern,
        label,
      );
    }
  } finally {
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('non-dry outcome fails closed without passing published acceptance evidence', async () => {
  const api = await outcomeApi();
  const artifactName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const fixture = createEvidenceFixture();
  try {
    const missing = createOptions(fixture, artifactName, false);
    delete missing.publishedReceiptPath;
    delete missing.publishedOperationalEvidencePath;
    assert.throws(
      () => api.createPublishOutcome(missing),
      /requires published and Tractor acceptance evidence/u,
    );

    const missingTractor = createOptions(fixture, artifactName, false);
    delete missingTractor.tractorBaselineRevision;
    delete missingTractor.tractorReportPath;
    delete missingTractor.tractorReportSha256;
    assert.throws(
      () => api.createPublishOutcome(missingTractor),
      /requires published and Tractor acceptance evidence/u,
    );

    const receipt = JSON.parse(
      fs.readFileSync(fixture.publishedReceiptPath, 'utf8'),
    );
    receipt.mode = 'source';
    fs.writeFileSync(
      fixture.publishedReceiptPath,
      `${JSON.stringify(receipt)}\n`,
    );
    assert.throws(
      () =>
        api.createPublishOutcome(createOptions(fixture, artifactName, false)),
      /published acceptance receipt is not a passing receipt/u,
    );
  } finally {
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('artifact discovery accepts one current outcome across all API pages', async () => {
  const api = await outcomeApi();
  const previousName = api.publishOutcomeArtifactName({
    runAttempt: publicationRunAttempt,
    runId,
  });
  const expectedName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const selected = api.selectPublishOutcomeArtifact(
    [
      { artifacts: [artifact(1, 'unrelated'), artifact(2, previousName)] },
      { artifacts: [artifact(3, expectedName)] },
    ],
    {
      completedAt: '2026-07-10T10:01:00Z',
      runAttempt: outcomeRunAttempt,
      runId,
    },
  );
  assert.equal(selected.id, 3);
  assert.equal(selected.name, expectedName);
});

test('artifact discovery fails closed for missing and cross-page duplicate outcomes', async () => {
  const api = await outcomeApi();
  const expectedName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const options = {
    completedAt: '2026-07-10T10:01:00Z',
    runAttempt: outcomeRunAttempt,
    runId,
  };

  assert.throws(
    () => api.selectPublishOutcomeArtifact([{ artifacts: [] }], options),
    /found 0/u,
  );
  assert.throws(
    () =>
      api.selectPublishOutcomeArtifact(
        [
          { artifacts: [artifact(1, expectedName)] },
          { artifacts: [artifact(2, expectedName)] },
        ],
        options,
      ),
    /found 2/u,
  );
});

test('artifact discovery fails closed for malformed, delayed, expired, and name-drift evidence', async () => {
  const api = await outcomeApi();
  const expectedName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const options = {
    completedAt: '2026-07-10T10:01:00Z',
    runAttempt: outcomeRunAttempt,
    runId,
  };
  const cases = [
    [[{ artifacts: 'not-an-array' }], /artifacts must be an array/u],
    [
      [{ artifacts: [{ expired: false, id: 1, name: expectedName }] }],
      /created_at must be an ISO timestamp/u,
    ],
    [
      [
        {
          artifacts: [
            artifact(1, expectedName, {
              created_at: '2026-07-10T10:02:00Z',
            }),
          ],
        },
      ],
      /created after the triggering run completed/u,
    ],
    [
      [{ artifacts: [artifact(1, expectedName, { expired: true })] }],
      /is expired/u,
    ],
    [
      [{ artifacts: [artifact(1, `${expectedName}-renamed`)] }],
      /artifact name drift/u,
    ],
  ];
  for (const [pages, pattern] of cases) {
    assert.throws(
      () => api.selectPublishOutcomeArtifact(pages, options),
      pattern,
    );
  }
});
