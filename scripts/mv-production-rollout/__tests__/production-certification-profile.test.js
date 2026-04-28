const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateMigrationContracts,
  validateProfileShape,
} = require('../../release-gates/validator');

const rootDir = path.resolve(__dirname, '../../..');
const profilePath = path.join(
  rootDir,
  'scripts/mv-production-rollout/production-certification-profile.json',
);

const readProfile = () => JSON.parse(fs.readFileSync(profilePath, 'utf8'));

const requiredEvidenceFiles = [
  'extraction-evidence.md',
  'trust-evidence.md',
  'fallback-evidence.md',
  'rollback-evidence.md',
  'design-system-evidence.md',
  'rollout-evidence.md',
  'incident-evidence.md',
  'review-evidence.md',
];

const requiredTargetIds = [
  'mv-extraction-drill-contract',
  'mv-trust-topology-contract',
  'mv-fallback-drill-contract',
  'mv-rollback-kill-switch-contract',
  'mv-design-system-bad-release-contract',
  'mv-rollout-adr-contract',
  'mv-incident-ownership-contract',
];

test('production certification profile has release-gates shape', () => {
  const profile = readProfile();

  assert.doesNotThrow(() => validateProfileShape(profile));
  assert.equal(profile.name, 'mv-production-rollout-certification-gates');
  assert.equal(
    profile.evidence.defaultDir,
    'docs/super-app-rfc-adr/evidence/mv-production-rollout/remote-commerce/current',
  );
  assert.deepEqual(profile.evidence.requiredFiles, requiredEvidenceFiles);
  assert.equal(profile.evidence.minimumReviewers, 2);
});

test('production certification requires MV rollout evidence metadata', () => {
  const profile = readProfile();

  for (const field of [
    'author',
    'timestamp',
    'ticket_id',
    'commit_sha',
    'workflow_run_url',
    'rollout_id',
    'production_environment',
  ]) {
    assert.ok(
      profile.evidence.requiredMetadataFields.includes(field),
      `expected required metadata field ${field}`,
    );
  }
});

test('production certification pins key rollout contract references', () => {
  const profile = readProfile();
  const targetsById = new Map(
    profile.migrationContracts.targets.map(target => [target.id, target]),
  );

  for (const id of requiredTargetIds) {
    assert.ok(targetsById.has(id), `expected target ${id}`);
  }

  assert.deepEqual(targetsById.get('mv-extraction-drill-contract').includes, [
    'validateExtractedVertical',
    'drill.rollback.evidenceRef',
    'drill.ownershipEvidence',
  ]);
  assert.ok(
    targetsById
      .get('mv-trust-topology-contract')
      .includes.includes('provenanceAttestation'),
  );
  assert.ok(
    targetsById
      .get('mv-fallback-drill-contract')
      .includes.includes('fallbackTelemetryPresent'),
  );
  assert.ok(
    targetsById
      .get('mv-rollback-kill-switch-contract')
      .includes.includes('rollbackRunbookRef'),
  );
  assert.ok(
    targetsById
      .get('mv-design-system-bad-release-contract')
      .includes.includes('horizontal-design-system'),
  );
  assert.ok(
    targetsById.get('mv-rollout-adr-contract').includes.includes('production'),
  );
  assert.ok(
    targetsById
      .get('mv-incident-ownership-contract')
      .includes.includes('"incidentHooks"'),
  );

  const report = validateMigrationContracts({
    rootDir,
    targets: profile.migrationContracts.targets,
  });
  assert.equal(report.length, requiredTargetIds.length);
});

test('production certification gate commands are direct node commands', () => {
  const profile = readProfile();

  assert.ok(profile.gateCommands.length > 0);
  for (const command of profile.gateCommands) {
    assert.match(command, /^node /);
    assert.doesNotMatch(command, /\b(?:npm|pnpm|yarn)\b/);
    assert.doesNotMatch(
      command,
      /validate-release-candidate-gates\.js(?!.*--skip-commands)/,
    );
  }
  assert.ok(
    profile.gateCommands.includes(
      'node --test scripts/mv-production-rollout/__tests__/production-certification-profile.test.js',
    ),
  );
});
