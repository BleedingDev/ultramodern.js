const test = require('node:test');
const assert = require('node:assert/strict');

const {
  diffConsumerImpact,
  loadDesignSystemBadReleaseDrill,
  validateDesignSystemBadReleaseDrill,
} = require('../design-system-bad-release-drill');

const clone = value => JSON.parse(JSON.stringify(value));

test('loads canonical DS bad-release drill and summarizes isolated rollback evidence', () => {
  const { drill, evidenceSummary } = loadDesignSystemBadReleaseDrill();

  assert.equal(drill.schemaVersion, 1);
  assert.equal(drill.designSystemRemote.kind, 'horizontal-design-system');
  assert.equal(evidenceSummary.designSystemRemoteId, 'remote-design-system');
  assert.equal(
    evidenceSummary.badArtifactId,
    'artifact-remote-design-system-2026-04-22-013',
  );
  assert.equal(evidenceSummary.badVersion, '1.15.0-wave2.0');
  assert.equal(evidenceSummary.badContractVersion, 'ds-contract-v1.15');
  assert.equal(
    evidenceSummary.rollbackTargetArtifactId,
    'artifact-remote-design-system-2026-04-15-009',
  );
  assert.equal(evidenceSummary.rollbackTargetVersion, '1.14.0-wave2.3');
  assert.deepEqual(evidenceSummary.impactedConsumers, ['remote-commerce']);
  assert.deepEqual(evidenceSummary.unaffectedConsumers, [
    'remote-identity',
    'shell-super-app',
  ]);
  assert.deepEqual(evidenceSummary.affectedVerticals, ['remote-commerce']);
  assert.deepEqual(evidenceSummary.unaffectedVerticals, ['remote-identity']);
  assert.equal(evidenceSummary.evidenceNotes, 3);
  assert.equal(evidenceSummary.remediationNotes, 3);
});

test('computes version skew and missing token/API impact for affected consumer', () => {
  const { drill } = loadDesignSystemBadReleaseDrill();
  const badArtifact = drill.artifacts.find(
    artifact => artifact.id === drill.designSystemRemote.badArtifactId,
  );
  const commerce = drill.consumers.find(
    consumer => consumer.id === 'remote-commerce',
  );

  assert.deepEqual(
    diffConsumerImpact({ consumer: commerce, badArtifact }).map(
      issue => issue.type,
    ),
    ['version-skew', 'missing-token', 'missing-api'],
  );
});

test('rejects drill when an unaffected vertical is impacted by the bad release', () => {
  const { drill } = loadDesignSystemBadReleaseDrill();
  const broken = clone(drill);
  const identity = broken.consumers.find(
    consumer => consumer.id === 'remote-identity',
  );
  identity.requiredTokens.push('color.checkout.warning');

  assert.throws(
    () => validateDesignSystemBadReleaseDrill(broken),
    /declared unaffected but bad release impacts "remote-identity"/,
  );
});

test('rejects drill when rollback metadata is missing', () => {
  const { drill } = loadDesignSystemBadReleaseDrill();
  const broken = clone(drill);
  delete broken.rollback.reason;

  assert.throws(
    () => validateDesignSystemBadReleaseDrill(broken),
    /drill\.rollback\.reason must be a non-empty string/,
  );
});
