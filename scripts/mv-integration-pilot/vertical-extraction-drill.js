const path = require('path');

const {
  DEFAULT_TOPOLOGY_PATH,
  loadReferenceTopology,
  readJsonFile,
} = require('./reference-topology');

const SCHEMA_VERSION = 1;
const REQUIRED_ENVS = ['development', 'staging', 'production'];

const DEFAULT_DRILL_PATH = path.resolve(
  __dirname,
  '__fixtures__/vertical-extraction.json',
);

const ensureObject = (value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
};

const ensureArray = (value, context) => {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
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

const stableStringify = value => JSON.stringify(value);

const clone = value => JSON.parse(JSON.stringify(value));

const getRouteSignature = route => ({
  id: route.id,
  path: route.path,
  remoteId: route.remoteId,
  entrypoint: route.entrypoint,
});

const ensureDeepEqual = ({ before, after, context }) => {
  if (stableStringify(before) !== stableStringify(after)) {
    throw new Error(`${context} must remain stable during vertical extraction`);
  }
};

const findRemote = (topology, remoteId) => {
  const remote = topology.remotes.find(candidate => candidate.id === remoteId);
  if (!remote) {
    throw new Error(
      `drill.extractedVerticalId references unknown remote "${remoteId}"`,
    );
  }
  return remote;
};

const validateShellStability = ({ drill, topology }) => {
  ensureObject(drill.shellStability, 'drill.shellStability');

  const { before, after } = drill.shellStability;
  ensureObject(before, 'drill.shellStability.before');
  ensureObject(after, 'drill.shellStability.after');
  ensureArray(before.remoteRefs, 'drill.shellStability.before.remoteRefs');
  ensureArray(after.remoteRefs, 'drill.shellStability.after.remoteRefs');
  ensureArray(before.routes, 'drill.shellStability.before.routes');
  ensureArray(after.routes, 'drill.shellStability.after.routes');

  ensureDeepEqual({
    before: topology.shell.remoteRefs,
    after: before.remoteRefs,
    context: 'drill.shellStability.before.remoteRefs',
  });
  ensureDeepEqual({
    before: before.remoteRefs,
    after: after.remoteRefs,
    context: 'drill.shellStability.after.remoteRefs',
  });

  const beforeRoutes = before.routes.map(getRouteSignature);
  const afterRoutes = after.routes.map(getRouteSignature);
  ensureDeepEqual({
    before: beforeRoutes,
    after: afterRoutes,
    context: 'drill.shellStability.routes',
  });

  for (const [index, route] of before.routes.entries()) {
    ensureString(route.id, `drill.shellStability.before.routes[${index}].id`);
    ensureString(
      route.path,
      `drill.shellStability.before.routes[${index}].path`,
    );
    ensureString(
      route.remoteId,
      `drill.shellStability.before.routes[${index}].remoteId`,
    );
    ensureString(
      route.entrypoint,
      `drill.shellStability.before.routes[${index}].entrypoint`,
    );
    if (!topology.shell.remoteRefs.includes(route.remoteId)) {
      throw new Error(
        `drill.shellStability.before.routes[${index}].remoteId is not a shell remoteRef`,
      );
    }
  }
};

const validateExtractedVertical = ({ drill, topology }) => {
  ensureString(drill.extractedVerticalId, 'drill.extractedVerticalId');
  const baseRemote = findRemote(topology, drill.extractedVerticalId);
  if (baseRemote.kind !== 'vertical') {
    throw new Error('drill.extractedVerticalId must target a vertical remote');
  }

  ensureObject(drill.extractedVertical, 'drill.extractedVertical');
  const extracted = drill.extractedVertical;
  if (extracted.id !== baseRemote.id) {
    throw new Error(
      'drill.extractedVertical.id must match extractedVerticalId',
    );
  }
  if (
    extracted.kind !== baseRemote.kind ||
    extracted.domain !== baseRemote.domain
  ) {
    throw new Error('drill.extractedVertical must preserve vertical identity');
  }

  const beforeStable = clone(baseRemote);
  const afterStable = clone(extracted);
  for (const mutableField of [
    'artifact',
    'moduleFederation',
    'urlIndirection',
    'envOverlays',
  ]) {
    delete beforeStable[mutableField];
    delete afterStable[mutableField];
  }
  ensureDeepEqual({
    before: beforeStable,
    after: afterStable,
    context: 'drill.extractedVertical non-deploy fields',
  });

  ensureObject(
    extracted.moduleFederation,
    'drill.extractedVertical.moduleFederation',
  );
  ensureString(
    extracted.moduleFederation.remoteEntry,
    'drill.extractedVertical.moduleFederation.remoteEntry',
  );
  ensureString(
    extracted.moduleFederation.ssrEntry,
    'drill.extractedVertical.moduleFederation.ssrEntry',
  );
  ensureString(
    extracted.moduleFederation.compatibilityDigest,
    'drill.extractedVertical.moduleFederation.compatibilityDigest',
  );
  ensureBoolean(
    extracted.moduleFederation.ssr,
    'drill.extractedVertical.moduleFederation.ssr',
  );
  if (extracted.moduleFederation.ssr !== baseRemote.moduleFederation.ssr) {
    throw new Error(
      'drill.extractedVertical.moduleFederation.ssr must stay stable',
    );
  }
  if (
    extracted.moduleFederation.fallbackTelemetryEvent !==
    baseRemote.moduleFederation.fallbackTelemetryEvent
  ) {
    throw new Error(
      'drill.extractedVertical.moduleFederation.fallbackTelemetryEvent must stay stable',
    );
  }
  if (
    extracted.moduleFederation.sharedContractVersion !==
    baseRemote.moduleFederation.sharedContractVersion
  ) {
    throw new Error(
      'drill.extractedVertical.moduleFederation.sharedContractVersion must stay stable',
    );
  }

  ensureObject(
    extracted.urlIndirection,
    'drill.extractedVertical.urlIndirection',
  );
  ensureString(
    extracted.urlIndirection.manifestUrl,
    'drill.extractedVertical.urlIndirection.manifestUrl',
  );
  ensureString(
    extracted.urlIndirection.cdnBaseUrl,
    'drill.extractedVertical.urlIndirection.cdnBaseUrl',
  );
  ensureObject(
    extracted.urlIndirection.environmentHostnames,
    'drill.extractedVertical.urlIndirection.environmentHostnames',
  );

  ensureObject(extracted.envOverlays, 'drill.extractedVertical.envOverlays');
  for (const env of REQUIRED_ENVS) {
    ensureObject(
      extracted.envOverlays[env],
      `drill.extractedVertical.envOverlays.${env}`,
    );
    ensureString(
      extracted.envOverlays[env].manifestAlias,
      `drill.extractedVertical.envOverlays.${env}.manifestAlias`,
    );
    ensureString(
      extracted.urlIndirection.environmentHostnames[env],
      `drill.extractedVertical.urlIndirection.environmentHostnames.${env}`,
    );
  }

  if (extracted.artifact.id === baseRemote.artifact.id) {
    throw new Error(
      'drill.extractedVertical.artifact.id must identify the extracted artifact',
    );
  }
  if (
    extracted.urlIndirection.manifestUrl ===
    baseRemote.urlIndirection.manifestUrl
  ) {
    throw new Error(
      'drill.extractedVertical.urlIndirection.manifestUrl must move through indirection',
    );
  }

  return baseRemote;
};

const validateRollback = ({ drill, baseRemote }) => {
  ensureObject(drill.rollback, 'drill.rollback');
  ensureBoolean(drill.rollback.available, 'drill.rollback.available');
  if (!drill.rollback.available) {
    throw new Error('drill.rollback.available must remain true');
  }
  if (drill.rollback.lkgArtifactId !== baseRemote.artifact.id) {
    throw new Error(
      'drill.rollback.lkgArtifactId must point at the pre-extraction LKG',
    );
  }
  ensureString(drill.rollback.manifestAlias, 'drill.rollback.manifestAlias');
  ensureString(drill.rollback.runbookRef, 'drill.rollback.runbookRef');
  ensureString(drill.rollback.evidenceRef, 'drill.rollback.evidenceRef');
};

const validateOwnershipEvidence = drill => {
  ensureObject(drill.ownershipEvidence, 'drill.ownershipEvidence');
  ['team', 'pagerDuty', 'runbookRef', 'adrRef', 'blastRadiusTier'].forEach(
    field =>
      ensureString(
        drill.ownershipEvidence[field],
        `drill.ownershipEvidence.${field}`,
      ),
  );
  ensureArray(
    drill.ownershipEvidence.blastRadiusRefs,
    'drill.ownershipEvidence.blastRadiusRefs',
  );
  if (drill.ownershipEvidence.blastRadiusRefs.length === 0) {
    throw new Error(
      'drill.ownershipEvidence.blastRadiusRefs must not be empty',
    );
  }
  drill.ownershipEvidence.blastRadiusRefs.forEach((reference, index) =>
    ensureString(
      reference,
      `drill.ownershipEvidence.blastRadiusRefs[${index}]`,
    ),
  );
};

const validateVerticalExtractionDrill = ({ drill, topology }) => {
  ensureObject(drill, 'drill');
  if (drill.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported drill schemaVersion: ${String(
        drill.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }
  ensureString(drill.id, 'drill.id');
  ensureString(drill.strategy, 'drill.strategy');
  if (drill.strategy !== 'url-indirection-environment-overlay') {
    throw new Error(
      'drill.strategy must be "url-indirection-environment-overlay"',
    );
  }

  validateShellStability({ drill, topology });
  const baseRemote = validateExtractedVertical({ drill, topology });
  validateRollback({ drill, baseRemote });
  validateOwnershipEvidence(drill);

  return {
    drillId: drill.id,
    extractedVerticalId: drill.extractedVerticalId,
    strategy: drill.strategy,
    stableShellRemoteRefs: drill.shellStability.after.remoteRefs,
    stableShellRoutes: drill.shellStability.after.routes.map(getRouteSignature),
    extractedArtifactId: drill.extractedVertical.artifact.id,
    extractedManifestUrl: drill.extractedVertical.urlIndirection.manifestUrl,
    rollbackArtifactId: drill.rollback.lkgArtifactId,
    ownershipTeam: drill.ownershipEvidence.team,
    blastRadiusRefs: drill.ownershipEvidence.blastRadiusRefs,
  };
};

const loadVerticalExtractionDrill = ({
  drillPath = DEFAULT_DRILL_PATH,
  topologyPath = DEFAULT_TOPOLOGY_PATH,
} = {}) => {
  const { topology } = loadReferenceTopology(topologyPath);
  const drill = readJsonFile(drillPath);
  const evidenceSummary = validateVerticalExtractionDrill({ drill, topology });

  return {
    drill,
    topology,
    evidenceSummary,
  };
};

module.exports = {
  DEFAULT_DRILL_PATH,
  loadVerticalExtractionDrill,
  validateVerticalExtractionDrill,
};
