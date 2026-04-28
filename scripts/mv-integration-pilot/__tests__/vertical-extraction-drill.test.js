const test = require('node:test');
const assert = require('node:assert/strict');

const { loadReferenceTopology } = require('../reference-topology');
const {
  loadVerticalExtractionDrill,
  validateVerticalExtractionDrill,
} = require('../vertical-extraction-drill');

const clone = value => JSON.parse(JSON.stringify(value));

test('loads vertical extraction drill with stable shell refs and route shape', () => {
  const { drill, evidenceSummary } = loadVerticalExtractionDrill();

  assert.equal(drill.id, 'uw2-04-vertical-extraction-drill');
  assert.equal(evidenceSummary.extractedVerticalId, 'remote-commerce');
  assert.equal(evidenceSummary.strategy, 'url-indirection-environment-overlay');
  assert.deepEqual(evidenceSummary.stableShellRemoteRefs, [
    'remote-commerce',
    'remote-identity',
    'remote-design-system',
  ]);
  assert.deepEqual(
    evidenceSummary.stableShellRoutes.map(route => route.id),
    ['commerce-cart', 'commerce-checkout', 'identity-profile'],
  );
  assert.equal(
    evidenceSummary.extractedArtifactId,
    'artifact-remote-commerce-2026-04-18-vertical-001',
  );
  assert.match(
    evidenceSummary.extractedManifestUrl,
    /\/remote-commerce\/independent\/current\.json$/,
  );
});

test('valid extraction preserves shell topology while changing only deploy indirection fields', () => {
  const { topology } = loadReferenceTopology();
  const { drill, evidenceSummary } = loadVerticalExtractionDrill();
  const baseCommerce = topology.remotes.find(
    remote => remote.id === 'remote-commerce',
  );

  assert.equal(drill.extractedVertical.id, baseCommerce.id);
  assert.equal(drill.extractedVertical.kind, baseCommerce.kind);
  assert.equal(drill.extractedVertical.domain, baseCommerce.domain);
  assert.deepEqual(
    drill.shellStability.after.remoteRefs,
    topology.shell.remoteRefs,
  );
  assert.notEqual(
    drill.extractedVertical.artifact.artifactUrl,
    baseCommerce.artifact.artifactUrl,
  );
  assert.notEqual(
    drill.extractedVertical.urlIndirection.manifestUrl,
    baseCommerce.urlIndirection.manifestUrl,
  );
  assert.equal(evidenceSummary.rollbackArtifactId, baseCommerce.artifact.id);
  assert.equal(evidenceSummary.ownershipTeam, 'commerce-experience');
  assert.ok(evidenceSummary.blastRadiusRefs.length > 0);
});

test('validateVerticalExtractionDrill rejects shell remote ref drift', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadVerticalExtractionDrill();
  const broken = clone(drill);
  broken.shellStability.after.remoteRefs = [
    'remote-commerce-extracted',
    'remote-identity',
    'remote-design-system',
  ];

  assert.throws(
    () => validateVerticalExtractionDrill({ drill: broken, topology }),
    /shellStability\.after\.remoteRefs must remain stable/,
  );
});

test('validateVerticalExtractionDrill rejects shell route refactor drift', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadVerticalExtractionDrill();
  const broken = clone(drill);
  broken.shellStability.after.routes[0].entrypoint =
    'commerce/ExtractedCartRoute';

  assert.throws(
    () => validateVerticalExtractionDrill({ drill: broken, topology }),
    /shellStability\.routes must remain stable/,
  );
});

test('validateVerticalExtractionDrill rejects missing rollback evidence', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadVerticalExtractionDrill();
  const broken = clone(drill);
  broken.rollback.available = false;

  assert.throws(
    () => validateVerticalExtractionDrill({ drill: broken, topology }),
    /rollback\.available must remain true/,
  );
});

test('validateVerticalExtractionDrill rejects missing ownership blast-radius evidence', () => {
  const { topology } = loadReferenceTopology();
  const { drill } = loadVerticalExtractionDrill();
  const broken = clone(drill);
  broken.ownershipEvidence.blastRadiusRefs = [];

  assert.throws(
    () => validateVerticalExtractionDrill({ drill: broken, topology }),
    /ownershipEvidence\.blastRadiusRefs must not be empty/,
  );
});
