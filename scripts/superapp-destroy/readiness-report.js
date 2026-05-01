#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const { REQUIRED_THRESHOLD_KEYS } = require('./run-superapp-destroy');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DESTROY_READINESS_SCHEMA_VERSION = 'superapp-destroy-readiness-v1';
const DEFAULT_JSON_ARTIFACT = 'destroy-readiness.json';
const DEFAULT_MARKDOWN_ARTIFACT = 'destroy-readiness.md';
const CLASSIFICATIONS = ['pass', 'warning', 'fail', 'unknown'];
const REQUIRED_LANES = Object.freeze([
  {
    id: 'load',
    label: 'Load, k6, and autocannon',
    phaseIds: ['warmup', 'load'],
  },
  {
    id: 'chaos',
    label: 'Chaos and recovery',
    phaseIds: ['chaos'],
  },
  {
    id: 'browser-runtime',
    label: 'Browser runtime during load',
    phaseIds: ['browser-smoke-during-load'],
  },
  {
    id: 'contracts',
    label: 'Effect and TanStack contracts',
    phaseIds: ['contracts'],
  },
  {
    id: 'runtime-matrix',
    label: 'Runtime matrix',
    phaseIds: ['runtime-matrix'],
  },
  {
    id: 'soak-stability',
    label: 'Soak and stability',
    phaseIds: ['soak-stability-evidence'],
  },
]);

const usage = () => `
Usage:
  node scripts/superapp-destroy/readiness-report.js --plan <destroy-plan.json> [options]

Options:
  --plan <path>                  Destroy plan JSON from run-superapp-destroy.js.
  --execution <path>             Optional destroy execution JSON.
  --artifact <lane=path>         Lane evidence JSON. Repeatable.
  --output-dir <path>            Output directory. Default: plan outputDir.
  --json <path>                  JSON artifact path. Default: <output-dir>/${DEFAULT_JSON_ARTIFACT}
  --markdown <path>              Markdown artifact path. Default: <output-dir>/${DEFAULT_MARKDOWN_ARTIFACT}
  --generated-at <iso>           Stable timestamp override for tests.
  --help                         Show this help.
`;

function parseArgs(argv, env = process.env) {
  const options = {
    artifactEntries: [],
    executionPath: env.SUPERAPP_DESTROY_EXECUTION,
    generatedAt: env.SUPERAPP_DESTROY_READINESS_GENERATED_AT,
    jsonPath: env.SUPERAPP_DESTROY_READINESS_JSON,
    markdownPath: env.SUPERAPP_DESTROY_READINESS_MARKDOWN,
    outputDir: env.SUPERAPP_DESTROY_READINESS_OUTPUT_DIR,
    planPath: env.SUPERAPP_DESTROY_PLAN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--plan':
        options.planPath = requireValue(argv, ++index, arg);
        break;
      case '--execution':
        options.executionPath = requireValue(argv, ++index, arg);
        break;
      case '--artifact':
        options.artifactEntries.push(
          parseArtifactEntry(requireValue(argv, ++index, arg)),
        );
        break;
      case '--output-dir':
        options.outputDir = requireValue(argv, ++index, arg);
        break;
      case '--json':
        options.jsonPath = requireValue(argv, ++index, arg);
        break;
      case '--markdown':
        options.markdownPath = requireValue(argv, ++index, arg);
        break;
      case '--generated-at':
        options.generatedAt = requireValue(argv, ++index, arg);
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.artifactEntries = [
    ...parseArtifactEntriesEnv(env.SUPERAPP_DESTROY_READINESS_ARTIFACTS),
    ...options.artifactEntries,
  ];
  options.planPath = options.planPath && resolveRepoPath(options.planPath);
  options.executionPath =
    options.executionPath && resolveRepoPath(options.executionPath);
  options.outputDir = options.outputDir && resolveRepoPath(options.outputDir);
  options.jsonPath = options.jsonPath && resolveRepoPath(options.jsonPath);
  options.markdownPath =
    options.markdownPath && resolveRepoPath(options.markdownPath);
  options.artifactEntries = options.artifactEntries.map(entry => ({
    ...entry,
    path: resolveRepoPath(entry.path),
  }));
  return options;
}

function createDestroyReadinessReport(input = {}, options = {}) {
  const plan = input.plan || {};
  const execution = input.execution;
  const artifactEntries = normalizeArtifactInputs(input.artifacts || []);
  const phaseResults = classifyPhases({ execution, plan });
  const lanes = REQUIRED_LANES.map(lane =>
    classifyLane({
      artifacts: artifactEntries.filter(entry => entry.lane === lane.id),
      lane,
      phaseResults,
      plan,
    }),
  );
  const classification = combineClassifications([
    ...phaseResults.map(phase => phase.classification),
    ...lanes.map(lane => lane.classification),
  ]);
  const missingEvidence = lanes
    .filter(lane => lane.classification === 'unknown')
    .flatMap(lane => lane.reasons.map(reason => `${lane.id}: ${reason}`));
  const failures = [
    ...phaseResults
      .filter(phase => phase.classification === 'fail')
      .flatMap(phase => phase.reasons.map(reason => `${phase.id}: ${reason}`)),
    ...lanes
      .filter(lane => lane.classification === 'fail')
      .flatMap(lane => lane.reasons.map(reason => `${lane.id}: ${reason}`)),
  ];
  const warnings = lanes
    .flatMap(lane => lane.warnings.map(warning => `${lane.id}: ${warning}`))
    .concat(
      phaseResults.flatMap(phase =>
        phase.warnings.map(warning => `${phase.id}: ${warning}`),
      ),
    );
  const report = pruneUndefined({
    schemaVersion: DESTROY_READINESS_SCHEMA_VERSION,
    suite: 'superapp-destroy-readiness',
    generatedAt: options.generatedAt || new Date().toISOString(),
    runId: plan.runId || execution?.runId,
    classification,
    profile: createProfileMetadata(plan),
    thresholds: createThresholdMetadata(plan),
    phases: phaseResults,
    lanes,
    missingEvidence,
    failures,
    warnings,
    provenance: {
      planPath: options.planPath,
      executionPath: options.executionPath,
      artifacts: artifactEntries.map(entry => ({
        lane: entry.lane,
        path: entry.path,
        provenance: entry.provenance,
        schemaVersion: entry.artifact?.schemaVersion,
        suite: entry.artifact?.suite,
      })),
    },
  });

  return {
    markdown: renderDestroyReadinessMarkdown(report),
    report,
  };
}

function writeDestroyReadinessReport(input = {}, options = {}) {
  const outputDir = path.resolve(
    options.outputDir || input.plan?.outputDir || process.cwd(),
  );
  const jsonPath = path.resolve(
    options.jsonPath || path.join(outputDir, DEFAULT_JSON_ARTIFACT),
  );
  const markdownPath = path.resolve(
    options.markdownPath || path.join(outputDir, DEFAULT_MARKDOWN_ARTIFACT),
  );
  const { markdown, report } = createDestroyReadinessReport(input, {
    ...options,
    jsonPath,
    markdownPath,
  });

  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown);

  return {
    markdown,
    markdownPath,
    report,
    reportPath: jsonPath,
  };
}

function renderDestroyReadinessMarkdown(report) {
  const lines = [
    '# SuperApp Destroy Readiness',
    '',
    `- Overall: ${report.classification}`,
    `- Run ID: ${report.runId || 'unknown'}`,
    `- Profile: ${report.profile.id}`,
    `- Usage: ${report.profile.usage || 'unknown'}`,
    `- Cost: ${report.profile.cost || 'unknown'}`,
    `- Default PR blocker: ${String(report.profile.defaultPrBlocker)}`,
    '',
    '## Lane Status',
    '',
    table(
      ['Lane', 'Classification', 'Reasons', 'Artifacts'],
      report.lanes.map(lane => [
        lane.label,
        lane.classification,
        lane.reasons.join('; ') || '-',
        lane.artifacts.map(artifact => artifact.path).join(', ') || '-',
      ]),
    ),
    '',
    '## Phase Status',
    '',
    table(
      ['Phase', 'Classification', 'Reasons'],
      report.phases.map(phase => [
        phase.id,
        phase.classification,
        phase.reasons.join('; ') || '-',
      ]),
    ),
    '',
    '## Thresholds',
    '',
    '```json',
    JSON.stringify(report.thresholds.budget || {}, null, 2),
    '```',
    '',
    '## Missing Evidence',
    '',
    ...renderList(report.missingEvidence),
    '',
    '## Failures',
    '',
    ...renderList(report.failures),
    '',
    '## Warnings',
    '',
    ...renderList(report.warnings),
    '',
    '## Artifacts And Provenance',
    '',
    ...renderList(
      report.provenance.artifacts.map(
        artifact => `${artifact.lane}: ${artifact.path}`,
      ),
    ),
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function classifyPhases({ execution, plan }) {
  const executionByPhase = new Map(
    (execution?.results || []).map(result => [result.phaseId, result]),
  );
  return (plan.phases || []).map(phase => {
    const executionResult = executionByPhase.get(phase.id);
    if (!execution) {
      return {
        id: phase.id,
        label: phase.label,
        classification: 'unknown',
        reasons: ['destroy execution artifact was not provided'],
        warnings: [],
      };
    }
    if (!executionResult) {
      return {
        id: phase.id,
        label: phase.label,
        classification: 'unknown',
        reasons: ['phase has no execution result'],
        warnings: [],
      };
    }

    const commandFailures = (executionResult.commands || []).filter(
      command => command.status === 'failed' || command.exitCode !== 0,
    );
    if (executionResult.status === 'failed' || commandFailures.length > 0) {
      return {
        id: phase.id,
        label: phase.label,
        classification: 'fail',
        reasons: [
          executionResult.reason || 'phase execution failed',
          ...commandFailures.map(
            command =>
              `${command.id} exited ${String(command.exitCode ?? command.status)}`,
          ),
        ],
        warnings: [],
      };
    }
    if (executionResult.status === 'skipped') {
      return {
        id: phase.id,
        label: phase.label,
        classification: 'unknown',
        reasons: [executionResult.reason || 'phase was skipped'],
        warnings: [],
      };
    }
    return {
      id: phase.id,
      label: phase.label,
      classification: 'pass',
      reasons: ['phase execution passed'],
      warnings: [],
    };
  });
}

function classifyLane({ artifacts, lane, phaseResults, plan }) {
  const plannedPhaseIds = new Set((plan.phases || []).map(phase => phase.id));
  const relatedPhases = phaseResults.filter(phase =>
    lane.phaseIds.includes(phase.id),
  );
  const relatedPhaseClasses = relatedPhases.map(phase => phase.classification);
  const reasons = [];
  const warnings = [];

  if (lane.phaseIds.every(phaseId => !plannedPhaseIds.has(phaseId))) {
    reasons.push('lane phase is not present in the destroy plan');
  }
  if (artifacts.length === 0) {
    reasons.push('required lane evidence artifact is missing');
  }

  const artifactClassifications = artifacts.map(entry => {
    const analysis = classifyArtifact(entry);
    reasons.push(...analysis.reasons);
    warnings.push(...analysis.warnings);
    return analysis.classification;
  });
  const classification = combineClassifications([
    ...artifactClassifications,
    ...relatedPhaseClasses.filter(value => value === 'fail'),
    artifacts.length === 0 ? 'unknown' : undefined,
    lane.phaseIds.every(phaseId => !plannedPhaseIds.has(phaseId))
      ? 'unknown'
      : undefined,
  ]);

  return {
    id: lane.id,
    label: lane.label,
    phaseIds: lane.phaseIds,
    classification,
    reasons: dedupe(reasons),
    warnings: dedupe(warnings),
    artifacts: artifacts.map(entry => ({
      path: entry.path,
      provenance: entry.provenance,
      classification: classifyArtifact(entry).classification,
      suite: entry.artifact?.suite,
    })),
  };
}

function classifyArtifact(entry) {
  const artifact = entry.artifact;
  if (!artifact) {
    return {
      classification: 'unknown',
      reasons: [`could not read artifact ${entry.path}: ${entry.readError}`],
      warnings: [],
    };
  }

  const budgetFailures = normalizeList(
    artifact.budgetFailures || artifact.thresholdFailures,
  );
  const unexpectedErrorCount = Number(artifact.unexpectedErrorCount || 0);
  const failedCount =
    Number(artifact.failedCount || 0) +
    Number(artifact.failedCommandCount || 0);
  const warnings = normalizeList(artifact.warnings).map(String);
  const unknowns = normalizeList(artifact.unknowns).map(String);
  const statusClassification = normalizeClassification(
    artifact.classification || artifact.status,
  );
  const reasons = [];

  if (budgetFailures.length > 0) {
    reasons.push(`threshold breach: ${summarizeList(budgetFailures)}`);
  }
  if (unexpectedErrorCount > 0) {
    reasons.push(`${unexpectedErrorCount} unexpected error(s)`);
  }
  if (failedCount > 0) {
    reasons.push(`${failedCount} failed check(s)`);
  }
  if (statusClassification === 'fail') {
    reasons.push(
      `artifact status is ${String(artifact.status || artifact.classification)}`,
    );
  }
  if (unknowns.length > 0) {
    reasons.push(`unknown evidence: ${summarizeList(unknowns)}`);
  }
  if (warnings.length > 0) {
    reasons.push(`warning evidence: ${summarizeList(warnings)}`);
  }

  const classification = combineClassifications([
    budgetFailures.length > 0 || unexpectedErrorCount > 0 || failedCount > 0
      ? 'fail'
      : undefined,
    statusClassification,
    unknowns.length > 0 ? 'unknown' : undefined,
    warnings.length > 0 ? 'warning' : undefined,
  ]);

  return {
    classification,
    reasons: reasons.length > 0 ? reasons : ['artifact passed'],
    warnings,
  };
}

function normalizeArtifactInputs(artifacts) {
  return artifacts.map(entry => {
    if (entry.artifact || entry.readError) {
      return entry;
    }
    try {
      return {
        ...entry,
        artifact: JSON.parse(fs.readFileSync(entry.path, 'utf8')),
      };
    } catch (error) {
      return {
        ...entry,
        readError: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function createProfileMetadata(plan) {
  const profileDefinition = plan.profileDefinition || {};
  return {
    id: profileDefinition.id || plan.profile || 'unknown',
    label: profileDefinition.label,
    usage: profileDefinition.usage,
    cost: profileDefinition.cost,
    defaultPrBlocker: profileDefinition.defaultPrBlocker,
    description: profileDefinition.description,
  };
}

function createThresholdMetadata(plan) {
  const budget =
    plan.thresholdBudget || plan.profileDefinition?.thresholds || {};
  const missingKeys = REQUIRED_THRESHOLD_KEYS.filter(
    key => !Object.hasOwn(budget, key),
  );
  return {
    budget,
    requiredKeys: REQUIRED_THRESHOLD_KEYS,
    missingKeys,
  };
}

function combineClassifications(values) {
  const normalized = values.map(normalizeClassification).filter(Boolean);
  if (normalized.includes('fail')) {
    return 'fail';
  }
  if (normalized.includes('unknown')) {
    return 'unknown';
  }
  if (normalized.includes('warning')) {
    return 'warning';
  }
  return 'pass';
}

function normalizeClassification(value) {
  if (!value) {
    return undefined;
  }
  const normalized = String(value).toLowerCase();
  if (CLASSIFICATIONS.includes(normalized)) {
    return normalized;
  }
  if (['passed', 'ready', 'ok', 'success'].includes(normalized)) {
    return 'pass';
  }
  if (['failed', 'not_ready', 'error'].includes(normalized)) {
    return 'fail';
  }
  if (['missing', 'planned', 'skipped', 'incomplete'].includes(normalized)) {
    return 'unknown';
  }
  return 'unknown';
}

function parseArtifactEntry(value) {
  const separator = value.indexOf('=');
  if (separator <= 0) {
    throw new Error(`Expected --artifact lane=path, received "${value}"`);
  }
  return {
    lane: value.slice(0, separator),
    path: value.slice(separator + 1),
    provenance: {
      source: 'cli',
    },
  };
}

function parseArtifactEntriesEnv(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(path.delimiter)
    .filter(Boolean)
    .map(parseArtifactEntry);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(header => (header === 'Artifacts' ? '---' : '---')).join(' | ')} |`,
    ...rows.map(row => `| ${row.map(formatTableCell).join(' | ')} |`),
  ].join('\n');
}

function formatTableCell(value) {
  return String(value ?? '')
    .replace(/\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function renderList(items) {
  if (!items || items.length === 0) {
    return ['- none'];
  }
  return items.map(item => `- ${item}`);
}

function summarizeList(items) {
  return items
    .map(item => {
      if (typeof item === 'string') {
        return item;
      }
      return item.message || item.id || JSON.stringify(item);
    })
    .join('; ');
}

function normalizeList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function pruneUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(pruneUndefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, pruneUndefined(entryValue)]),
  );
}

function resolveRepoPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.planPath) {
    throw new Error('Missing required --plan <destroy-plan.json>');
  }

  const plan = readJsonFile(options.planPath);
  const execution = options.executionPath
    ? readJsonFile(options.executionPath)
    : undefined;
  const result = writeDestroyReadinessReport(
    {
      artifacts: options.artifactEntries,
      execution,
      plan,
    },
    {
      executionPath: options.executionPath,
      generatedAt: options.generatedAt,
      jsonPath: options.jsonPath,
      markdownPath: options.markdownPath,
      outputDir: options.outputDir || plan.outputDir,
      planPath: options.planPath,
    },
  );

  console.log(
    JSON.stringify(
      {
        classification: result.report.classification,
        markdownPath: result.markdownPath,
        reportPath: result.reportPath,
        schemaVersion: result.report.schemaVersion,
      },
      null,
      2,
    ),
  );
  if (result.report.classification === 'fail') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  CLASSIFICATIONS,
  DEFAULT_JSON_ARTIFACT,
  DEFAULT_MARKDOWN_ARTIFACT,
  DESTROY_READINESS_SCHEMA_VERSION,
  REQUIRED_LANES,
  createDestroyReadinessReport,
  parseArgs,
  renderDestroyReadinessMarkdown,
  writeDestroyReadinessReport,
};
