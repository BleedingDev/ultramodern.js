const path = require('path');

const { loadReferenceTopology, readJsonFile } = require('./reference-topology');

const SCHEMA_VERSION = 1;
const REQUIRED_FAILURE_MODES = [
  'remote-timeout',
  'network-failure',
  'integrity-mismatch',
];
const CANONICAL_FALLBACKS = {
  'remote-timeout': {
    reason: 'timeout',
    code: 'MV_TIMEOUT',
    phase: 'load',
  },
  'network-failure': {
    reason: 'entry_load_failed',
    code: 'MV_ENTRY_LOAD_FAILED',
    phase: 'load',
  },
  'integrity-mismatch': {
    reason: 'integrity_mismatch',
    code: 'MV_INTEGRITY_MISMATCH',
    phase: 'integrity',
  },
};
const REQUIRED_FALLBACK_FIELDS = ['reason', 'code', 'phase'];
const DEFAULT_DRILLS_PATH = path.resolve(
  __dirname,
  '__fixtures__/remote-failure-drills.json',
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
    shell: topology.shell,
    remotesById: new Map(topology.remotes.map(remote => [remote.id, remote])),
    componentsById: new Map(
      components.map(component => [component.id, component]),
    ),
  };
};

const assertReference = ({ references, targetId, context }) => {
  ensureString(targetId, context);
  if (!references.has(targetId)) {
    throw new Error(`${context} references unknown topology id "${targetId}"`);
  }
};

const validateRemediation = (remediation, context) => {
  ensureObject(remediation, context);
  ['ownerTeam', 'runbookRef', 'evidenceRef'].forEach(field =>
    ensureString(remediation[field], `${context}.${field}`),
  );
};

const validateTelemetry = (telemetry, context) => {
  ensureObject(telemetry, context);
  ensureString(telemetry.eventName, `${context}.eventName`);
  ensureObject(telemetry.fallback, `${context}.fallback`);
  REQUIRED_FALLBACK_FIELDS.forEach(field =>
    ensureString(telemetry.fallback[field], `${context}.fallback.${field}`),
  );
  ensureString(telemetry.evidenceRef, `${context}.evidenceRef`);
};

const validateDrill = ({ drill, context, topologyIndex }) => {
  ensureObject(drill, context);
  [
    'id',
    'title',
    'failureMode',
    'environment',
    'affectedRemoteId',
    'expectedFallbackComponentId',
  ].forEach(field => ensureString(drill[field], `${context}.${field}`));

  if (!REQUIRED_FAILURE_MODES.includes(drill.failureMode)) {
    throw new Error(
      `${context}.failureMode must be one of ${REQUIRED_FAILURE_MODES.join(
        ', ',
      )}`,
    );
  }

  assertReference({
    references: topologyIndex.remotesById,
    targetId: drill.affectedRemoteId,
    context: `${context}.affectedRemoteId`,
  });
  assertReference({
    references: topologyIndex.componentsById,
    targetId: drill.expectedFallbackComponentId,
    context: `${context}.expectedFallbackComponentId`,
  });

  ensureObject(drill.expectations, `${context}.expectations`);
  ensureBoolean(
    drill.expectations.shellSurvives,
    `${context}.expectations.shellSurvives`,
  );
  ensureBoolean(
    drill.expectations.fallbackTelemetryPresent,
    `${context}.expectations.fallbackTelemetryPresent`,
  );
  ensureBoolean(
    drill.expectations.affectedRemoteIsolated,
    `${context}.expectations.affectedRemoteIsolated`,
  );
  ensureArray(
    drill.expectations.unaffectedComponentIds,
    `${context}.expectations.unaffectedComponentIds`,
  );
  drill.expectations.unaffectedComponentIds.forEach((componentId, index) =>
    assertReference({
      references: topologyIndex.componentsById,
      targetId: componentId,
      context: `${context}.expectations.unaffectedComponentIds[${index}]`,
    }),
  );

  validateTelemetry(drill.telemetry, `${context}.telemetry`);
  validateRemediation(drill.remediation, `${context}.remediation`);
};

const assertDrillPasses = ({ drill, context }) => {
  if (!drill.expectations.shellSurvives) {
    throw new Error(`${context} must prove shell survivability`);
  }
  if (!drill.expectations.fallbackTelemetryPresent) {
    throw new Error(`${context} must include fallback telemetry`);
  }
  if (!drill.expectations.affectedRemoteIsolated) {
    throw new Error(`${context} must isolate the affected remote`);
  }
  if (
    drill.expectations.unaffectedComponentIds.includes(drill.affectedRemoteId)
  ) {
    throw new Error(
      `${context} must not list the affected remote as unaffected`,
    );
  }

  for (const field of REQUIRED_FALLBACK_FIELDS) {
    const canonicalValue = CANONICAL_FALLBACKS[drill.failureMode][field];
    if (drill.expectedFallback[field] !== canonicalValue) {
      throw new Error(
        `${context}.expectedFallback.${field} must match canonical ${field}`,
      );
    }
    if (drill.telemetry.fallback[field] !== canonicalValue) {
      throw new Error(
        `${context}.telemetry.fallback.${field} must match canonical fallback ${field}`,
      );
    }
  }
};

const validateExpectedFallback = (drill, context) => {
  ensureObject(drill.expectedFallback, `${context}.expectedFallback`);
  REQUIRED_FALLBACK_FIELDS.forEach(field =>
    ensureString(
      drill.expectedFallback[field],
      `${context}.expectedFallback.${field}`,
    ),
  );
};

const validateRemoteFailureDrills = ({ drills, topology }) => {
  ensureObject(drills, 'drills');
  if (drills.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported drills schemaVersion: ${String(
        drills.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }
  ensureString(drills.id, 'drills.id');
  ensureArray(drills.passCases, 'drills.passCases');
  ensureArray(drills.failCases, 'drills.failCases');
  ensureUniqueIds(
    [...drills.passCases, ...drills.failCases],
    'remote failure drills',
  );

  const topologyIndex = buildTopologyIndex(topology);
  const seenFailureModes = new Set();
  const allDrills = [...drills.passCases, ...drills.failCases];

  allDrills.forEach((drill, index) => {
    const context = `remote failure drills[${index}]`;
    validateDrill({ drill, context, topologyIndex });
    validateExpectedFallback(drill, context);
    seenFailureModes.add(drill.failureMode);
  });

  REQUIRED_FAILURE_MODES.forEach(failureMode => {
    if (!seenFailureModes.has(failureMode)) {
      throw new Error(`drills must include ${failureMode} coverage`);
    }
  });

  drills.passCases.forEach((drill, index) =>
    assertDrillPasses({
      drill,
      context: `drills.passCases[${index}]`,
    }),
  );

  return summarizeRemoteFailureDrills({ drills, topology });
};

const summarizeRemoteFailureDrills = ({ drills, topology }) => {
  const topologyIndex = buildTopologyIndex(topology);
  const passCases = drills.passCases.map(drill => {
    const affectedRemote = topologyIndex.remotesById.get(
      drill.affectedRemoteId,
    );
    return {
      id: drill.id,
      failureMode: drill.failureMode,
      environment: drill.environment,
      affectedRemoteId: drill.affectedRemoteId,
      affectedRemoteKind: affectedRemote.kind,
      shellSurvives: drill.expectations.shellSurvives,
      fallbackTelemetryPresent: drill.expectations.fallbackTelemetryPresent,
      affectedRemoteIsolated: drill.expectations.affectedRemoteIsolated,
      fallbackReason: drill.expectedFallback.reason,
      fallbackCode: drill.expectedFallback.code,
      fallbackPhase: drill.expectedFallback.phase,
      evidenceRef: drill.telemetry.evidenceRef,
      remediationRef: drill.remediation.runbookRef,
    };
  });

  return {
    drillSetId: drills.id,
    schemaVersion: drills.schemaVersion,
    topologyId: topology.id,
    shellId: topology.shell.id,
    passCaseCount: drills.passCases.length,
    failCaseCount: drills.failCases.length,
    coveredFailureModes: [
      ...new Set(
        [...drills.passCases, ...drills.failCases].map(
          drill => drill.failureMode,
        ),
      ),
    ],
    passCases,
  };
};

const loadRemoteFailureDrills = ({
  drillsPath = DEFAULT_DRILLS_PATH,
  topologyPath,
} = {}) => {
  const { topology } = loadReferenceTopology(topologyPath);
  const drills = readJsonFile(drillsPath);
  const evidenceSummary = validateRemoteFailureDrills({ drills, topology });

  return {
    drills,
    topology,
    evidenceSummary,
  };
};

module.exports = {
  CANONICAL_FALLBACKS,
  DEFAULT_DRILLS_PATH,
  REQUIRED_FAILURE_MODES,
  loadRemoteFailureDrills,
  summarizeRemoteFailureDrills,
  validateRemoteFailureDrills,
};
