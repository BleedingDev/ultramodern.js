const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runGateCommands,
  validateEvidence,
  validateMigrationContracts,
  validateProfileShape,
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
    gateCommands: [],
  };

  assert.doesNotThrow(() => validateProfileShape(profile));
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
    });

    assert.equal(report.validatedFiles.length, 4);
    assert.equal(report.skippedFiles.length, 0);
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

test('runGateCommands throws on failing command', () => {
  assert.throws(
    () =>
      runGateCommands({
        commands: [`"${process.execPath}" -e "process.exit(2)"`],
      }),
    /exit code 2/,
  );
});
