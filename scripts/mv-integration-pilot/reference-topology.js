const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const REQUIRED_ENVS = ['development', 'staging', 'production'];
const REQUIRED_REMOTE_KINDS = ['vertical', 'horizontal-design-system'];
const DIGEST_PATTERN = /^sha256-[a-f0-9]{64}$/;
const SRI_PATTERN = /^sha384-[A-Za-z0-9+/=]+$/;

const DEFAULT_TOPOLOGY_PATH = path.resolve(
  __dirname,
  '__fixtures__/reference-topology.json',
);

const readJsonFile = filePath => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const ensureObject = (value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
};

const ensureString = (value, context) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context} must be a non-empty string`);
  }
};

const ensureBoolean = (value, context) => {
  if (typeof value !== 'boolean') {
    throw new Error(`${context} must be a boolean`);
  }
};

const ensureArray = (value, context) => {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
};

const ensureUniqueIds = (items, context) => {
  const seen = new Set();
  for (const item of items) {
    ensureObject(item, `${context} item`);
    ensureString(item.id, `${context}.id`);
    if (seen.has(item.id)) {
      throw new Error(`${context} contains duplicate id "${item.id}"`);
    }
    seen.add(item.id);
  }
};

const ensureReference = ({ references, targetId, context }) => {
  ensureString(targetId, context);
  if (!references.has(targetId)) {
    throw new Error(`${context} references unknown id "${targetId}"`);
  }
};

const validateArtifactMetadata = (artifact, context) => {
  ensureObject(artifact, context);
  [
    'id',
    'version',
    'gitSha',
    'buildId',
    'createdAt',
    'artifactUrl',
    'contentDigest',
    'integrity',
    'sbomDigest',
    'signature',
  ].forEach(field => ensureString(artifact[field], `${context}.${field}`));

  if (!DIGEST_PATTERN.test(artifact.contentDigest)) {
    throw new Error(`${context}.contentDigest must be a sha256 digest`);
  }
  if (!DIGEST_PATTERN.test(artifact.sbomDigest)) {
    throw new Error(`${context}.sbomDigest must be a sha256 digest`);
  }
  if (!SRI_PATTERN.test(artifact.integrity)) {
    throw new Error(`${context}.integrity must be a sha384 SRI value`);
  }

  ensureObject(
    artifact.provenanceAttestation,
    `${context}.provenanceAttestation`,
  );
  ['url', 'digest', 'builder', 'policy'].forEach(field =>
    ensureString(
      artifact.provenanceAttestation[field],
      `${context}.provenanceAttestation.${field}`,
    ),
  );
  if (!DIGEST_PATTERN.test(artifact.provenanceAttestation.digest)) {
    throw new Error(
      `${context}.provenanceAttestation.digest must be a sha256 digest`,
    );
  }
};

const validateUrlIndirection = (urlIndirection, context) => {
  ensureObject(urlIndirection, context);
  ensureString(urlIndirection.manifestUrl, `${context}.manifestUrl`);
  ensureString(urlIndirection.cdnBaseUrl, `${context}.cdnBaseUrl`);
  ensureObject(
    urlIndirection.environmentHostnames,
    `${context}.environmentHostnames`,
  );
  REQUIRED_ENVS.forEach(env =>
    ensureString(
      urlIndirection.environmentHostnames[env],
      `${context}.environmentHostnames.${env}`,
    ),
  );
};

const validateEnvOverlays = (envOverlays, context) => {
  ensureObject(envOverlays, context);
  REQUIRED_ENVS.forEach(env => {
    const overlay = envOverlays[env];
    ensureObject(overlay, `${context}.${env}`);
    ['releaseChannel', 'manifestAlias', 'configDigest'].forEach(field =>
      ensureString(overlay[field], `${context}.${env}.${field}`),
    );
    if (!DIGEST_PATTERN.test(overlay.configDigest)) {
      throw new Error(`${context}.${env}.configDigest must be a sha256 digest`);
    }
    ensureBoolean(overlay.enabled, `${context}.${env}.enabled`);
  });
};

const validateModuleFederationRemote = (moduleFederation, context) => {
  ensureObject(moduleFederation, context);
  [
    'remoteEntry',
    'ssrEntry',
    'compatibilityDigest',
    'fallbackTelemetryEvent',
    'sharedContractVersion',
  ].forEach(field =>
    ensureString(moduleFederation[field], `${context}.${field}`),
  );
  ensureBoolean(moduleFederation.ssr, `${context}.ssr`);
  if (!moduleFederation.remoteEntry.startsWith('https://')) {
    throw new Error(`${context}.remoteEntry must be an immutable HTTPS URL`);
  }
  if (!moduleFederation.ssrEntry.startsWith('https://')) {
    throw new Error(`${context}.ssrEntry must be an immutable HTTPS URL`);
  }
  if (!DIGEST_PATTERN.test(moduleFederation.compatibilityDigest)) {
    throw new Error(`${context}.compatibilityDigest must be a sha256 digest`);
  }
  if (
    moduleFederation.fallbackTelemetryEvent !== 'modernjs:mv-runtime-parity'
  ) {
    throw new Error(
      `${context}.fallbackTelemetryEvent must use the shared MV fallback telemetry event`,
    );
  }
};

const validateControlPlane = ({
  controlPlane,
  artifactIds,
  componentId,
  context,
}) => {
  ensureObject(controlPlane, context);
  ensureObject(controlPlane.lkg, `${context}.lkg`);
  ensureReference({
    references: artifactIds,
    targetId: controlPlane.lkg.artifactId,
    context: `${context}.lkg.artifactId`,
  });
  ensureString(controlPlane.lkg.promotedAt, `${context}.lkg.promotedAt`);
  ensureString(controlPlane.lkg.reason, `${context}.lkg.reason`);

  ensureObject(controlPlane.revocation, `${context}.revocation`);
  ensureBoolean(
    controlPlane.revocation.revoked,
    `${context}.revocation.revoked`,
  );
  ensureString(
    controlPlane.revocation.policyRef,
    `${context}.revocation.policyRef`,
  );
  ensureString(
    controlPlane.revocation.evidenceRef,
    `${context}.revocation.evidenceRef`,
  );

  ensureObject(controlPlane.killSwitch, `${context}.killSwitch`);
  ensureBoolean(
    controlPlane.killSwitch.enabled,
    `${context}.killSwitch.enabled`,
  );
  ensureString(controlPlane.killSwitch.flag, `${context}.killSwitch.flag`);
  if (controlPlane.killSwitch.targetId !== componentId) {
    throw new Error(
      `${context}.killSwitch.targetId must match component id "${componentId}"`,
    );
  }
};

const validateOwnership = (ownership, context) => {
  ensureObject(ownership, context);
  ['team', 'slack', 'pagerDuty', 'runbookRef', 'adrRef'].forEach(field =>
    ensureString(ownership[field], `${context}.${field}`),
  );
  ensureObject(ownership.blastRadius, `${context}.blastRadius`);
  ensureString(ownership.blastRadius.tier, `${context}.blastRadius.tier`);
  ensureArray(
    ownership.blastRadius.references,
    `${context}.blastRadius.references`,
  );
  ownership.blastRadius.references.forEach((reference, index) =>
    ensureString(reference, `${context}.blastRadius.references[${index}]`),
  );
};

const validateComponent = ({ component, context, artifactIds }) => {
  validateUrlIndirection(component.urlIndirection, `${context}.urlIndirection`);
  validateArtifactMetadata(component.artifact, `${context}.artifact`);
  artifactIds.add(component.artifact.id);
  validateEnvOverlays(component.envOverlays, `${context}.envOverlays`);
  validateOwnership(component.ownership, `${context}.ownership`);
};

const validateReferenceTopology = topology => {
  ensureObject(topology, 'topology');
  if (topology.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported topology schemaVersion: ${String(
        topology.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }
  if (topology.preset !== 'presetUltramodern') {
    throw new Error('topology.preset must be "presetUltramodern"');
  }

  ensureObject(topology.shell, 'topology.shell');
  ensureArray(topology.remotes, 'topology.remotes');
  ensureArray(topology.effectServices, 'topology.effectServices');

  ensureString(topology.shell.id, 'topology.shell.id');
  ensureUniqueIds(topology.remotes, 'topology.remotes');
  ensureUniqueIds(topology.effectServices, 'topology.effectServices');

  const componentIds = new Set([topology.shell.id]);
  topology.remotes.forEach(remote => componentIds.add(remote.id));
  topology.effectServices.forEach(service => componentIds.add(service.id));

  const artifactIds = new Set();
  validateComponent({
    component: topology.shell,
    context: 'topology.shell',
    artifactIds,
  });
  topology.remotes.forEach((remote, index) =>
    validateComponent({
      component: remote,
      context: `topology.remotes[${index}]`,
      artifactIds,
    }),
  );
  topology.effectServices.forEach((service, index) =>
    validateComponent({
      component: service,
      context: `topology.effectServices[${index}]`,
      artifactIds,
    }),
  );

  ensureArray(topology.shell.remoteRefs, 'topology.shell.remoteRefs');
  topology.shell.remoteRefs.forEach((remoteId, index) =>
    ensureReference({
      references: componentIds,
      targetId: remoteId,
      context: `topology.shell.remoteRefs[${index}]`,
    }),
  );

  const remoteKindCounts = new Map();
  topology.remotes.forEach((remote, index) => {
    ensureString(remote.kind, `topology.remotes[${index}].kind`);
    validateModuleFederationRemote(
      remote.moduleFederation,
      `topology.remotes[${index}].moduleFederation`,
    );
    remoteKindCounts.set(
      remote.kind,
      (remoteKindCounts.get(remote.kind) || 0) + 1,
    );
    validateControlPlane({
      controlPlane: remote.controlPlane,
      artifactIds,
      componentId: remote.id,
      context: `topology.remotes[${index}].controlPlane`,
    });
  });

  if (remoteKindCounts.get('vertical') !== 2) {
    throw new Error('topology must define exactly two vertical remotes');
  }
  if (remoteKindCounts.get('horizontal-design-system') !== 1) {
    throw new Error(
      'topology must define exactly one horizontal design-system remote',
    );
  }
  REQUIRED_REMOTE_KINDS.forEach(kind => {
    if (!remoteKindCounts.has(kind)) {
      throw new Error(`topology.remotes is missing remote kind "${kind}"`);
    }
  });

  validateControlPlane({
    controlPlane: topology.shell.controlPlane,
    artifactIds,
    componentId: topology.shell.id,
    context: 'topology.shell.controlPlane',
  });

  topology.effectServices.forEach((service, index) => {
    ensureString(service.runtime, `topology.effectServices[${index}].runtime`);
    if (service.runtime !== 'effect') {
      throw new Error(
        `topology.effectServices[${index}].runtime must be "effect"`,
      );
    }
    ensureArray(
      service.consumedBy,
      `topology.effectServices[${index}].consumedBy`,
    );
    service.consumedBy.forEach((consumerId, consumerIndex) =>
      ensureReference({
        references: componentIds,
        targetId: consumerId,
        context: `topology.effectServices[${index}].consumedBy[${consumerIndex}]`,
      }),
    );
    validateControlPlane({
      controlPlane: service.controlPlane,
      artifactIds,
      componentId: service.id,
      context: `topology.effectServices[${index}].controlPlane`,
    });
  });

  const designSystemRemote = topology.remotes.find(
    remote => remote.kind === 'horizontal-design-system',
  );
  ensureObject(
    designSystemRemote.designSystem,
    'topology.remotes[design-system].designSystem',
  );
  ensureArray(
    designSystemRemote.designSystem.consumerPins,
    'topology.remotes[design-system].designSystem.consumerPins',
  );
  designSystemRemote.designSystem.consumerPins.forEach((pin, index) => {
    ensureObject(
      pin,
      `topology.remotes[design-system].designSystem.consumerPins[${index}]`,
    );
    ensureReference({
      references: componentIds,
      targetId: pin.consumerId,
      context: `topology.remotes[design-system].designSystem.consumerPins[${index}].consumerId`,
    });
    ensureReference({
      references: artifactIds,
      targetId: pin.pinnedArtifactId,
      context: `topology.remotes[design-system].designSystem.consumerPins[${index}].pinnedArtifactId`,
    });
    ensureString(
      pin.contractVersion,
      `topology.remotes[design-system].designSystem.consumerPins[${index}].contractVersion`,
    );
  });

  return summarizeTopologyEvidence(topology);
};

const summarizeTopologyEvidence = topology => {
  const components = [
    topology.shell,
    ...topology.remotes,
    ...topology.effectServices,
  ];
  const remotesByKind = topology.remotes.reduce((summary, remote) => {
    summary[remote.kind] = (summary[remote.kind] || 0) + 1;
    return summary;
  }, {});

  return {
    topologyId: topology.id,
    schemaVersion: topology.schemaVersion,
    preset: topology.preset,
    shellId: topology.shell.id,
    componentCount: components.length,
    remoteCount: topology.remotes.length,
    remotesByKind,
    effectServiceCount: topology.effectServices.length,
    artifactIds: components.map(component => component.artifact.id),
    lkgArtifactIds: components.map(
      component => component.controlPlane.lkg.artifactId,
    ),
    urlIndirectionEntries: components.length,
    environmentOverlays: REQUIRED_ENVS,
    killSwitchFlags: components.map(
      component => component.controlPlane.killSwitch.flag,
    ),
    revokedComponents: components
      .filter(component => component.controlPlane.revocation.revoked)
      .map(component => component.id),
    designSystemConsumerPins:
      topology.remotes.find(
        remote => remote.kind === 'horizontal-design-system',
      )?.designSystem.consumerPins.length || 0,
    mfSsrRemoteCount: topology.remotes.filter(
      remote => remote.moduleFederation?.ssr === true,
    ).length,
    fallbackTelemetryEvents: [
      ...new Set(
        topology.remotes.map(
          remote => remote.moduleFederation?.fallbackTelemetryEvent,
        ),
      ),
    ].filter(Boolean),
    ownershipRefs: components.map(component => ({
      id: component.id,
      team: component.ownership.team,
      blastRadiusTier: component.ownership.blastRadius.tier,
      blastRadiusRefs: component.ownership.blastRadius.references,
    })),
  };
};

const loadReferenceTopology = (topologyPath = DEFAULT_TOPOLOGY_PATH) => {
  const topology = readJsonFile(topologyPath);
  const evidenceSummary = validateReferenceTopology(topology);
  return {
    topology,
    evidenceSummary,
  };
};

module.exports = {
  DEFAULT_TOPOLOGY_PATH,
  readJsonFile,
  summarizeTopologyEvidence,
  validateReferenceTopology,
  loadReferenceTopology,
};
