const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadReferenceTopology,
  validateReferenceTopology,
} = require('../reference-topology');

const clone = value => JSON.parse(JSON.stringify(value));

test('loads canonical Wave 2 reference topology and summarizes evidence', () => {
  const { topology, evidenceSummary } = loadReferenceTopology();

  assert.equal(topology.schemaVersion, 1);
  assert.equal(topology.preset, 'presetUltramodern');
  assert.equal(evidenceSummary.preset, 'presetUltramodern');
  assert.equal(topology.shell.kind, 'shell');
  assert.equal(topology.remotes.length, 3);
  assert.equal(evidenceSummary.shellId, 'shell-super-app');
  assert.equal(evidenceSummary.componentCount, 5);
  assert.equal(evidenceSummary.remoteCount, 3);
  assert.equal(evidenceSummary.remotesByKind.vertical, 2);
  assert.equal(evidenceSummary.remotesByKind['horizontal-design-system'], 1);
  assert.equal(evidenceSummary.effectServiceCount, 1);
  assert.equal(evidenceSummary.designSystemConsumerPins, 3);
  assert.equal(evidenceSummary.mfSsrRemoteCount, 3);
  assert.deepEqual(evidenceSummary.fallbackTelemetryEvents, [
    'modernjs:mv-runtime-parity',
  ]);
  assert.deepEqual(evidenceSummary.environmentOverlays, [
    'development',
    'staging',
    'production',
  ]);
  assert.equal(evidenceSummary.revokedComponents.length, 0);
  assert.ok(
    evidenceSummary.killSwitchFlags.includes(
      'mv.wave2.remote-commerce.disable',
    ),
  );
});

test('canonical topology carries URL, artifact, LKG, ownership, and DS pin metadata', () => {
  const { topology } = loadReferenceTopology();
  const components = [
    topology.shell,
    ...topology.remotes,
    ...topology.effectServices,
  ];
  const designSystemRemote = topology.remotes.find(
    remote => remote.kind === 'horizontal-design-system',
  );

  for (const component of components) {
    assert.match(component.urlIndirection.manifestUrl, /^https:\/\//);
    assert.match(component.artifact.contentDigest, /^sha256-/);
    assert.match(component.artifact.integrity, /^sha384-/);
    assert.match(component.artifact.sbomDigest, /^sha256-/);
    assert.match(component.artifact.provenanceAttestation.digest, /^sha256-/);
    assert.equal(
      component.controlPlane.lkg.artifactId,
      component.artifact.id,
      `${component.id} LKG should point at its immutable artifact`,
    );
    assert.equal(component.controlPlane.revocation.revoked, false);
    assert.equal(component.controlPlane.killSwitch.targetId, component.id);
    assert.ok(component.ownership.blastRadius.references.length > 0);
  }

  for (const remote of topology.remotes) {
    assert.equal(remote.moduleFederation.ssr, true);
    assert.match(remote.moduleFederation.remoteEntry, /^https:\/\//);
    assert.match(remote.moduleFederation.ssrEntry, /^https:\/\//);
    assert.match(remote.moduleFederation.compatibilityDigest, /^sha256-/);
    assert.equal(
      remote.moduleFederation.fallbackTelemetryEvent,
      'modernjs:mv-runtime-parity',
    );
  }

  assert.deepEqual(
    designSystemRemote.designSystem.consumerPins.map(pin => pin.consumerId),
    ['shell-super-app', 'remote-commerce', 'remote-identity'],
  );
  assert.ok(
    designSystemRemote.designSystem.consumerPins.every(
      pin =>
        pin.pinnedArtifactId === designSystemRemote.artifact.id &&
        pin.contractVersion === designSystemRemote.designSystem.contractVersion,
    ),
  );
});

test('validateReferenceTopology rejects a second preset or DS-specific non-MF mode', () => {
  const { topology } = loadReferenceTopology();
  const broken = clone(topology);
  broken.preset = 'presetMicroVerticals';

  assert.throws(
    () => validateReferenceTopology(broken),
    /topology\.preset must be "presetUltramodern"/,
  );

  const brokenDesignSystem = clone(topology);
  delete brokenDesignSystem.remotes.find(
    remote => remote.kind === 'horizontal-design-system',
  ).moduleFederation;

  assert.throws(
    () => validateReferenceTopology(brokenDesignSystem),
    /topology\.remotes\[2\]\.moduleFederation must be an object/,
  );
});

test('validateReferenceTopology rejects broken component references', () => {
  const { topology } = loadReferenceTopology();
  const broken = clone(topology);
  broken.remotes.find(
    remote => remote.kind === 'horizontal-design-system',
  ).designSystem.consumerPins[0].consumerId = 'remote-missing';

  assert.throws(
    () => validateReferenceTopology(broken),
    /references unknown id "remote-missing"/,
  );
});

test('validateReferenceTopology rejects broken immutable artifact metadata', () => {
  const { topology } = loadReferenceTopology();
  const broken = clone(topology);
  broken.remotes[0].artifact.integrity = 'missing-sri-prefix';

  assert.throws(
    () => validateReferenceTopology(broken),
    /artifact\.integrity must be a sha384 SRI value/,
  );
});
