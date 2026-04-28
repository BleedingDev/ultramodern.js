const path = require('path');

const {
  DEFAULT_TOPOLOGY_PATH,
  loadReferenceTopology,
  readJsonFile,
} = require('./reference-topology');

const SCHEMA_VERSION = 1;
const FALLBACK_ORDER = [
  'current',
  'environment-overlay',
  'lkg',
  'csr-fallback',
];
const DEFAULT_DRILL_PATH = path.resolve(
  __dirname,
  '__fixtures__/rollback-kill-switch.json',
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

const ensureNumber = (value, context) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${context} must be a non-negative number`);
  }
};

const ensureStringArray = (value, context) => {
  ensureArray(value, context);
  value.forEach((item, index) => ensureString(item, `${context}[${index}]`));
};

const ensureUniqueIds = (items, context) => {
  const seen = new Set();
  items.forEach((item, index) => {
    ensureObject(item, `${context}[${index}]`);
    ensureString(item.id, `${context}[${index}].id`);
    if (seen.has(item.id)) {
      throw new Error(`${context} contains duplicate id "${item.id}"`);
    }
    seen.add(item.id);
  });
};

const buildTopologyIndex = topology => {
  const components = [
    topology.shell,
    ...topology.remotes,
    ...topology.effectServices,
  ];

  return {
    componentsById: new Map(
      components.map(component => [component.id, component]),
    ),
  };
};

const createArtifactMap = artifacts =>
  new Map(artifacts.map(artifact => [artifact.id, artifact]));

const validateArtifactCatalog = artifacts => {
  ensureArray(artifacts, 'drill.artifacts');
  ensureUniqueIds(artifacts, 'drill.artifacts');
  artifacts.forEach((artifact, index) => {
    const context = `drill.artifacts[${index}]`;
    ['id', 'stage', 'version', 'manifestRef', 'evidenceRef'].forEach(field =>
      ensureString(artifact[field], `${context}.${field}`),
    );
    if (!FALLBACK_ORDER.includes(artifact.stage)) {
      throw new Error(
        `${context}.stage must be one of ${FALLBACK_ORDER.join(', ')}`,
      );
    }
  });
};

const validateFallbackPlan = ({ fallbackPlan, artifactMap, component }) => {
  ensureObject(fallbackPlan, 'drill.fallbackPlan');
  ensureStringArray(fallbackPlan.order, 'drill.fallbackPlan.order');
  if (JSON.stringify(fallbackPlan.order) !== JSON.stringify(FALLBACK_ORDER)) {
    throw new Error(
      `drill.fallbackPlan.order must be ${FALLBACK_ORDER.join(' -> ')}`,
    );
  }

  ensureObject(fallbackPlan.artifacts, 'drill.fallbackPlan.artifacts');
  for (const stage of FALLBACK_ORDER) {
    ensureString(
      fallbackPlan.artifacts[stage],
      `drill.fallbackPlan.artifacts.${stage}`,
    );
    if (!artifactMap.has(fallbackPlan.artifacts[stage])) {
      throw new Error(
        `drill.fallbackPlan.artifacts.${stage} references unknown artifact "${fallbackPlan.artifacts[stage]}"`,
      );
    }
    const artifact = artifactMap.get(fallbackPlan.artifacts[stage]);
    if (artifact.stage !== stage) {
      throw new Error(
        `drill.fallbackPlan.artifacts.${stage} must reference a ${stage} artifact`,
      );
    }
  }

  if (fallbackPlan.artifacts.lkg !== component.controlPlane.lkg.artifactId) {
    throw new Error(
      'drill.fallbackPlan.artifacts.lkg must match topology controlPlane LKG',
    );
  }

  ensureString(
    fallbackPlan.selectedArtifactId,
    'drill.fallbackPlan.selectedArtifactId',
  );
  ensureString(fallbackPlan.selectedStage, 'drill.fallbackPlan.selectedStage');
  if (!FALLBACK_ORDER.includes(fallbackPlan.selectedStage)) {
    throw new Error(
      `drill.fallbackPlan.selectedStage must be one of ${FALLBACK_ORDER.join(
        ', ',
      )}`,
    );
  }
  if (
    fallbackPlan.artifacts[fallbackPlan.selectedStage] !==
    fallbackPlan.selectedArtifactId
  ) {
    throw new Error(
      'drill.fallbackPlan.selectedArtifactId must match selectedStage artifact',
    );
  }
};

const validateRevocation = ({ revocation, fallbackPlan, killSwitch }) => {
  ensureObject(revocation, 'drill.revocation');
  ensureStringArray(
    revocation.revokedArtifactIds,
    'drill.revocation.revokedArtifactIds',
  );
  ['policyRef', 'evidenceRef'].forEach(field =>
    ensureString(revocation[field], `drill.revocation.${field}`),
  );
  ensureBoolean(
    revocation.overridesFallbackSelection,
    'drill.revocation.overridesFallbackSelection',
  );
  if (!revocation.overridesFallbackSelection) {
    throw new Error('drill.revocation.overridesFallbackSelection must be true');
  }

  const revoked = new Set(revocation.revokedArtifactIds);
  if (revoked.has(fallbackPlan.selectedArtifactId)) {
    throw new Error(
      `drill.fallbackPlan.selectedArtifactId "${fallbackPlan.selectedArtifactId}" is revoked`,
    );
  }
  if (revoked.has(killSwitch.replacementArtifactId)) {
    throw new Error(
      `drill.killSwitch.replacementArtifactId "${killSwitch.replacementArtifactId}" is revoked`,
    );
  }

  const selectedIndex = FALLBACK_ORDER.indexOf(fallbackPlan.selectedStage);
  for (const stage of FALLBACK_ORDER.slice(0, selectedIndex)) {
    const artifactId = fallbackPlan.artifacts[stage];
    if (!revoked.has(artifactId)) {
      throw new Error(
        `drill.revocation must revoke skipped ${stage} artifact "${artifactId}" before selecting ${fallbackPlan.selectedStage}`,
      );
    }
  }
};

const validateKillSwitch = ({ killSwitch, component, artifactMap }) => {
  ensureObject(killSwitch, 'drill.killSwitch');
  ensureBoolean(killSwitch.enabled, 'drill.killSwitch.enabled');
  ['targetId', 'flag', 'replacementArtifactId', 'evidenceRef'].forEach(field =>
    ensureString(killSwitch[field], `drill.killSwitch.${field}`),
  );
  if (killSwitch.targetId !== component.id) {
    throw new Error(
      `drill.killSwitch.targetId must match target component "${component.id}"`,
    );
  }
  if (killSwitch.flag !== component.controlPlane.killSwitch.flag) {
    throw new Error(
      'drill.killSwitch.flag must match topology kill-switch flag',
    );
  }
  if (!artifactMap.has(killSwitch.replacementArtifactId)) {
    throw new Error(
      `drill.killSwitch.replacementArtifactId references unknown artifact "${killSwitch.replacementArtifactId}"`,
    );
  }
};

const validateIncidentSlo = incidentSlo => {
  ensureObject(incidentSlo, 'drill.incidentSlo');
  ['name', 'severity'].forEach(field =>
    ensureString(incidentSlo[field], `drill.incidentSlo.${field}`),
  );
  [
    'detectBudgetMs',
    'mitigateBudgetMs',
    'totalBudgetMs',
    'detectedInMs',
    'mitigatedInMs',
    'totalElapsedMs',
  ].forEach(field =>
    ensureNumber(incidentSlo[field], `drill.incidentSlo.${field}`),
  );

  if (incidentSlo.detectedInMs > incidentSlo.detectBudgetMs) {
    throw new Error('drill.incidentSlo detectedInMs breaches detectBudgetMs');
  }
  if (incidentSlo.mitigatedInMs > incidentSlo.mitigateBudgetMs) {
    throw new Error(
      'drill.incidentSlo mitigatedInMs breaches mitigateBudgetMs',
    );
  }
  if (incidentSlo.totalElapsedMs > incidentSlo.totalBudgetMs) {
    throw new Error('drill.incidentSlo totalElapsedMs breaches totalBudgetMs');
  }
};

const validateTelemetry = telemetry => {
  ensureObject(telemetry, 'drill.telemetry');
  ['eventName', 'decisionEventName', 'evidenceRef'].forEach(field =>
    ensureString(telemetry[field], `drill.telemetry.${field}`),
  );
  ensureStringArray(telemetry.metricRefs, 'drill.telemetry.metricRefs');
};

const validateEvidence = evidence => {
  ensureObject(evidence, 'drill.evidence');
  [
    'incidentRef',
    'rollbackRunbookRef',
    'killSwitchRunbookRef',
    'operatorLogRef',
  ].forEach(field => ensureString(evidence[field], `drill.evidence.${field}`));
  ensureArray(
    evidence.relatedDrillReports,
    'drill.evidence.relatedDrillReports',
  );
  evidence.relatedDrillReports.forEach((report, index) => {
    const context = `drill.evidence.relatedDrillReports[${index}]`;
    ['id', 'summaryRef'].forEach(field =>
      ensureString(report[field], `${context}.${field}`),
    );
  });
};

const validateRollbackKillSwitchDrill = ({ drill, topology }) => {
  ensureObject(drill, 'drill');
  if (drill.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported drill schemaVersion: ${String(
        drill.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }

  ['id', 'description', 'environment', 'targetComponentId'].forEach(field =>
    ensureString(drill[field], `drill.${field}`),
  );

  const topologyIndex = buildTopologyIndex(topology);
  const component = topologyIndex.componentsById.get(drill.targetComponentId);
  if (!component) {
    throw new Error(
      `drill.targetComponentId references unknown topology id "${drill.targetComponentId}"`,
    );
  }

  validateArtifactCatalog(drill.artifacts);
  const artifactMap = createArtifactMap(drill.artifacts);
  validateKillSwitch({ killSwitch: drill.killSwitch, component, artifactMap });
  validateFallbackPlan({
    fallbackPlan: drill.fallbackPlan,
    artifactMap,
    component,
  });
  validateRevocation({
    revocation: drill.revocation,
    fallbackPlan: drill.fallbackPlan,
    killSwitch: drill.killSwitch,
  });
  validateIncidentSlo(drill.incidentSlo);
  validateTelemetry(drill.telemetry);
  validateEvidence(drill.evidence);

  return summarizeRollbackKillSwitchDrill({ drill, topology, component });
};

const summarizeRollbackKillSwitchDrill = ({ drill, topology, component }) => ({
  drillId: drill.id,
  topologyId: topology.id,
  environment: drill.environment,
  targetComponentId: drill.targetComponentId,
  targetKind: component.kind,
  fallbackOrder: drill.fallbackPlan.order,
  selectedStage: drill.fallbackPlan.selectedStage,
  selectedArtifactId: drill.fallbackPlan.selectedArtifactId,
  killSwitchTargetId: drill.killSwitch.targetId,
  killSwitchFlag: drill.killSwitch.flag,
  replacementArtifactId: drill.killSwitch.replacementArtifactId,
  revokedArtifactIds: drill.revocation.revokedArtifactIds,
  incidentSlo: {
    name: drill.incidentSlo.name,
    severity: drill.incidentSlo.severity,
    detectBudgetMs: drill.incidentSlo.detectBudgetMs,
    mitigateBudgetMs: drill.incidentSlo.mitigateBudgetMs,
    totalBudgetMs: drill.incidentSlo.totalBudgetMs,
    detectedInMs: drill.incidentSlo.detectedInMs,
    mitigatedInMs: drill.incidentSlo.mitigatedInMs,
    totalElapsedMs: drill.incidentSlo.totalElapsedMs,
  },
  telemetryRef: drill.telemetry.evidenceRef,
  evidenceRefs: {
    incidentRef: drill.evidence.incidentRef,
    rollbackRunbookRef: drill.evidence.rollbackRunbookRef,
    killSwitchRunbookRef: drill.evidence.killSwitchRunbookRef,
    operatorLogRef: drill.evidence.operatorLogRef,
  },
  relatedDrillReports: drill.evidence.relatedDrillReports,
});

const loadRollbackKillSwitchDrill = ({
  drillPath = DEFAULT_DRILL_PATH,
  topologyPath = DEFAULT_TOPOLOGY_PATH,
} = {}) => {
  const { topology } = loadReferenceTopology(topologyPath);
  const drill = readJsonFile(drillPath);
  const evidenceSummary = validateRollbackKillSwitchDrill({
    drill,
    topology,
  });

  return {
    drill,
    topology,
    evidenceSummary,
  };
};

module.exports = {
  DEFAULT_DRILL_PATH,
  FALLBACK_ORDER,
  loadRollbackKillSwitchDrill,
  summarizeRollbackKillSwitchDrill,
  validateRollbackKillSwitchDrill,
};
