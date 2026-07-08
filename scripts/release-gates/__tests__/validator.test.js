const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runGateCommands,
  validateEvidence,
  validateGateSnapshotFile,
  validateMigrationContracts,
  validateProfileShape,
  writeGateSnapshot,
} = require('../validator');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-release-gates-'));

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

test('validateProfileShape accepts valid schema', () => {
  const profile = {
    schemaVersion: 1,
    evidence: {
      requiredFiles: ['architecture-evidence.md'],
      requiredMetadataFields: ['author'],
    },
    migrationContracts: {
      targets: [],
    },
    gateCommands: [
      {
        command: process.execPath,
        args: ['--version'],
      },
    ],
  };

  assert.doesNotThrow(() => validateProfileShape(profile));
});

test('validateProfileShape rejects shell-string gate commands', () => {
  const profile = {
    schemaVersion: 1,
    evidence: {
      requiredFiles: [],
      requiredMetadataFields: [],
    },
    migrationContracts: {
      targets: [],
    },
    gateCommands: ['pnpm test'],
  };

  assert.throws(
    () => validateProfileShape(profile),
    /gateCommands\[0\] must be a command object/,
  );
});

test('validateEvidence checks metadata and reviewer count', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'architecture-evidence.md'),
      'author: test\ntimestamp: now\nticket_id: id\ncommit_sha: sha\nworkflow_run_url: local\n',
    );
    fs.writeFileSync(
      path.join(dir, 'validation-evidence.md'),
      'author: test\ntimestamp: now\nticket_id: id\ncommit_sha: sha\nworkflow_run_url: local\n',
    );
    fs.writeFileSync(
      path.join(dir, 'test-evidence.md'),
      'author: test\ntimestamp: now\nticket_id: id\ncommit_sha: sha\nworkflow_run_url: local\n',
    );
    fs.writeFileSync(
      path.join(dir, 'review-evidence.md'),
      'author: test\ntimestamp: now\nticket_id: id\ncommit_sha: sha\nworkflow_run_url: local\nreviewer_1: alpha\nreviewer_2: beta\n',
    );

    const report = validateEvidence({
      evidenceDir: dir,
      requiredFiles: [
        'architecture-evidence.md',
        'validation-evidence.md',
        'test-evidence.md',
        'review-evidence.md',
      ],
      requiredMetadataFields: [
        'author',
        'timestamp',
        'ticket_id',
        'commit_sha',
        'workflow_run_url',
      ],
      minimumReviewers: 2,
      allowMissingEvidence: false,
      allowLocalEvidenceMetadata: true,
    });

    assert.equal(report.validatedFiles.length, 4);
    assert.equal(report.skippedFiles.length, 0);
  } finally {
    removeDir(dir);
  }
});

test('validateEvidence rejects dirty commit metadata when CI evidence is required', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'architecture-evidence.md'),
      [
        'author: test',
        'timestamp: now',
        'ticket_id: id',
        'commit_sha: 123abc-dirty',
        'workflow_run_url: https://github.com/BleedingDev/ultramodern.js/actions/runs/123456789',
        '',
      ].join('\n'),
    );

    assert.throws(
      () =>
        validateEvidence({
          evidenceDir: dir,
          requiredFiles: ['architecture-evidence.md'],
          requiredMetadataFields: [
            'author',
            'timestamp',
            'ticket_id',
            'commit_sha',
            'workflow_run_url',
          ],
          minimumReviewers: 0,
          allowMissingEvidence: false,
          requireCiBackedMetadata: true,
        }),
      /commit_sha.*dirty/i,
    );
  } finally {
    removeDir(dir);
  }
});

test('validateEvidence rejects local workflow URLs when CI evidence is required', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'architecture-evidence.md'),
      [
        'author: test',
        'timestamp: now',
        'ticket_id: id',
        'commit_sha: 123abc',
        'workflow_run_url: local://release-gates/manual-fixture',
        '',
      ].join('\n'),
    );

    assert.throws(
      () =>
        validateEvidence({
          evidenceDir: dir,
          requiredFiles: ['architecture-evidence.md'],
          requiredMetadataFields: [
            'author',
            'timestamp',
            'ticket_id',
            'commit_sha',
            'workflow_run_url',
          ],
          minimumReviewers: 0,
          allowMissingEvidence: false,
          requireCiBackedMetadata: true,
        }),
      /workflow_run_url.*local/i,
    );
  } finally {
    removeDir(dir);
  }
});

test('validateEvidence rejects placeholder metadata values', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'architecture-evidence.md'),
      'author: test\ntimestamp: now\nticket_id: id\ncommit_sha: TBD\nworkflow_run_url: local://manual\n',
    );

    assert.throws(
      () =>
        validateEvidence({
          evidenceDir: dir,
          requiredFiles: ['architecture-evidence.md'],
          requiredMetadataFields: [
            'author',
            'timestamp',
            'ticket_id',
            'commit_sha',
            'workflow_run_url',
          ],
          minimumReviewers: 2,
          allowMissingEvidence: false,
        }),
      /placeholder value/,
    );
  } finally {
    removeDir(dir);
  }
});

test('validateMigrationContracts checks snippets', () => {
  const dir = makeTempDir();
  try {
    const fixture = path.join(dir, 'fixture.txt');
    fs.writeFileSync(fixture, 'alpha beta gamma traceId spanId');

    const report = validateMigrationContracts({
      rootDir: dir,
      targets: [
        {
          id: 'fixture-contract',
          path: 'fixture.txt',
          includes: ['alpha', 'traceId', 'spanId'],
        },
      ],
    });

    assert.equal(report.length, 1);
    assert.equal(report[0].id, 'fixture-contract');
  } finally {
    removeDir(dir);
  }
});

test('validateMigrationContracts auto-builds missing dist artifacts when enabled', () => {
  const dir = makeTempDir();
  try {
    const appDir = path.join(dir, 'integration/demo-app');
    const artifactPath = path.join(appDir, 'dist-1/client/effect/index.js');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify(
        {
          name: 'demo-app',
          version: '1.0.0',
          scripts: {
            build: 'node ./build.js',
          },
        },
        null,
        2,
      ),
    );

    const executed = [];
    const report = validateMigrationContracts({
      rootDir: dir,
      allowAutoBuildArtifacts: true,
      commandRunner: commandSpec => {
        executed.push(commandSpec);
        fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
        fs.writeFileSync(artifactPath, 'const operationManifest = true;');
      },
      targets: [
        {
          id: 'generated-contract',
          path: 'integration/demo-app/dist-1/client/effect/index.js',
          includes: ['operationManifest'],
        },
      ],
    });

    assert.equal(report.length, 1);
    assert.equal(executed.length, 1);
    assert.equal(executed[0].command, 'pnpm');
    assert.deepEqual(executed[0].args, ['--dir', appDir, 'run', 'build']);
    assert.match(executed[0].label, /pnpm --dir/);
  } finally {
    removeDir(dir);
  }
});

test('validateMigrationContracts can skip command-required generated artifacts', () => {
  const dir = makeTempDir();
  try {
    const staticPath = path.join(dir, 'static-contract.txt');
    fs.writeFileSync(staticPath, 'static contract');

    const report = validateMigrationContracts({
      rootDir: dir,
      skipCommandRequiredTargets: true,
      targets: [
        {
          id: 'static-contract',
          path: 'static-contract.txt',
          includes: ['static contract'],
        },
        {
          id: 'generated-contract',
          path: 'integration/demo-app/dist/client/index.js',
          includes: ['generated contract'],
          requiresCommands: true,
        },
      ],
    });

    assert.deepEqual(
      report.map(item => item.id),
      ['static-contract'],
    );
  } finally {
    removeDir(dir);
  }
});

test('validateMigrationContracts fails auto-build when package has no build script', () => {
  const dir = makeTempDir();
  try {
    const appDir = path.join(dir, 'integration/no-build-app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify(
        {
          name: 'no-build-app',
          version: '1.0.0',
        },
        null,
        2,
      ),
    );

    assert.throws(
      () =>
        validateMigrationContracts({
          rootDir: dir,
          allowAutoBuildArtifacts: true,
          targets: [
            {
              id: 'missing-artifact',
              path: 'integration/no-build-app/dist/client/index.js',
              includes: ['anything'],
            },
          ],
        }),
      /does not define scripts\.build/,
    );
  } finally {
    removeDir(dir);
  }
});

test('runGateCommands throws on failing command', () => {
  assert.throws(
    () =>
      runGateCommands({
        commands: [
          {
            command: process.execPath,
            args: ['-e', 'process.exit(2)'],
          },
        ],
      }),
    /exit code 2/,
  );
});

test('writeGateSnapshot persists and merges gate records', () => {
  const dir = makeTempDir();
  try {
    const snapshotPath = path.join(dir, 'contract-gates.json');
    const first = writeGateSnapshot({
      snapshotPath,
      gateName: 'release-candidate-contract-gates',
      passed: true,
      summary: { validatedEvidenceFiles: 4 },
      profilePath: 'scripts/release-gates/rc-contract-profile.json',
      timestamp: 1700000000000,
    });
    assert.equal(first.passed, true);

    const second = writeGateSnapshot({
      snapshotPath,
      gateName: 'module-onboarding-certification-gates',
      passed: false,
      reason: 'reviewer evidence missing',
      summary: { error: 'reviewer evidence missing' },
      profilePath: 'scripts/release-gates/module-certification-profile.json',
      timestamp: 1700000001000,
    });
    assert.equal(second.passed, false);

    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.updatedAt, 1700000001000);
    assert.equal(
      snapshot.gates['release-candidate-contract-gates'].passed,
      true,
    );
    assert.equal(
      snapshot.gates['module-onboarding-certification-gates'].passed,
      false,
    );
    assert.match(
      snapshot.gates['module-onboarding-certification-gates'].reason,
      /reviewer evidence missing/,
    );
  } finally {
    removeDir(dir);
  }
});

test('validateGateSnapshotFile validates shape and required gate names', () => {
  const dir = makeTempDir();
  try {
    const snapshotPath = path.join(dir, 'contract-gates.json');
    writeGateSnapshot({
      snapshotPath,
      gateName: 'release-candidate-contract-gates',
      passed: true,
      summary: { validatedEvidenceFiles: 4 },
      profilePath: 'scripts/release-gates/rc-contract-profile.json',
      timestamp: 1700000000000,
    });

    const report = validateGateSnapshotFile({
      snapshotPath,
      requiredGateNames: ['release-candidate-contract-gates'],
    });
    assert.equal(report.gateCount, 1);
    assert.deepEqual(report.gates, ['release-candidate-contract-gates']);

    assert.throws(
      () =>
        validateGateSnapshotFile({
          snapshotPath,
          requiredGateNames: ['module-onboarding-certification-gates'],
        }),
      /missing required gate/,
    );
  } finally {
    removeDir(dir);
  }
});
