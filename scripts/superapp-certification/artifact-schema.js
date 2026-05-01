const fs = require('node:fs');
const path = require('node:path');

const SUPERAPP_ARTIFACT_SCHEMA_VERSION = 1;

const SUPERAPP_READINESS_DIMENSIONS = [
  'contract',
  'integration',
  'stress',
  'soak',
  'browser',
  'module-federation',
  'security',
  'performance',
  'upstream-drift',
];

const SUPERAPP_ARTIFACT_STATUSES = ['passed', 'warning', 'failed', 'unknown'];

function createArtifactEnvelope(input) {
  const startedAt = input.startedAt || new Date().toISOString();
  const finishedAt = input.finishedAt || new Date().toISOString();
  const budgetFailures = normalizeList(input.budgetFailures);
  const warnings = normalizeList(input.warnings);
  const unknowns = normalizeList(input.unknowns);
  const status =
    input.status ||
    deriveArtifactStatus({
      budgetFailures,
      warnings,
      unknowns,
      unexpectedErrorCount: input.unexpectedErrorCount,
    });

  return {
    schemaVersion: SUPERAPP_ARTIFACT_SCHEMA_VERSION,
    suite: input.suite,
    target: input.target,
    profile: input.profile,
    status,
    startedAt,
    finishedAt,
    durationMs:
      input.durationMs === undefined
        ? durationBetween(startedAt, finishedAt)
        : input.durationMs,
    dimensions: normalizeDimensions(input.dimensions),
    parameters: input.parameters || {},
    budgets: input.budgets || {},
    budgetFailures,
    warnings,
    unknowns,
    observations: normalizeList(input.observations),
    metrics: input.metrics || {},
    artifacts: normalizeArtifacts(input.artifacts),
    detail: input.detail || {},
  };
}

function deriveArtifactStatus(input) {
  if (
    normalizeList(input.budgetFailures).length > 0 ||
    Number(input.unexpectedErrorCount || 0) > 0
  ) {
    return 'failed';
  }
  if (normalizeList(input.unknowns).length > 0) {
    return 'unknown';
  }
  if (normalizeList(input.warnings).length > 0) {
    return 'warning';
  }
  return 'passed';
}

function writeArtifactSummary(outputPath, summary) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function normalizeDimensions(dimensions) {
  const values = normalizeList(dimensions);
  return values.filter(value => SUPERAPP_READINESS_DIMENSIONS.includes(value));
}

function normalizeArtifacts(artifacts) {
  if (!artifacts) {
    return [];
  }
  return normalizeList(artifacts).map(item =>
    typeof item === 'string'
      ? {
          path: item,
        }
      : item,
  );
}

function normalizeList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function durationBetween(startedAt, finishedAt) {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return 0;
  }
  return Math.max(0, finished - started);
}

module.exports = {
  SUPERAPP_ARTIFACT_SCHEMA_VERSION,
  SUPERAPP_ARTIFACT_STATUSES,
  SUPERAPP_READINESS_DIMENSIONS,
  createArtifactEnvelope,
  deriveArtifactStatus,
  writeArtifactSummary,
};
