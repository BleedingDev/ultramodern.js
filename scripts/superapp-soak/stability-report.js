#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const { analyzeSoakDrift } = require('./drift-detectors');
const { SOAK_ERROR_CLASSES } = require('./metrics-windows');
const { getSoakProfileDefinition } = require('./profile-catalog');

const SOAK_STABILITY_REPORT_SCHEMA_VERSION =
  'superapp-soak-stability-report-v1';
const DEFAULT_JSON_ARTIFACT = 'soak-stability-report.json';
const DEFAULT_MARKDOWN_APPENDIX = 'soak-stability-appendix.md';

const STATUS_TO_CLASSIFICATION = {
  failed: 'fail',
  passed: 'pass',
  unknown: 'unknown',
  warning: 'warning',
};

const usage = () => `
Usage:
  node scripts/superapp-soak/stability-report.js --summary <summary.json> [options]

Options:
  --summary <path>       SuperApp soak summary artifact or window summary JSON.
  --output-dir <path>    Directory for generated report artifacts.
  --json <path>          JSON artifact path. Default: <output-dir>/${DEFAULT_JSON_ARTIFACT}
  --markdown <path>      Markdown appendix path. Default: <output-dir>/${DEFAULT_MARKDOWN_APPENDIX}
  --help                 Show this help.
`;

function createSoakStabilityReport(input = {}, options = {}) {
  const source =
    input.summaryArtifact || input.artifact || input.summary || input;
  const metricsSummary = normalizeMetricsSummary(source);
  const profile = resolveReportProfile(source, options);
  const drift =
    options.drift ||
    source.detail?.drift ||
    analyzeSoakDrift(metricsSummary, {
      profile,
      thresholds: options.thresholds,
    });
  const status = normalizeStatus(
    options.status || source.status || drift.status,
  );
  const detectorResults = normalizeDetectorResults(drift.detectors || []);
  const observedStabilityEnvelope = createObservedStabilityEnvelope({
    metricsSummary,
    parameters: source.parameters || {},
    profile,
    source,
  });
  const artifacts = normalizeArtifacts({
    source,
    options,
    markdownPath: options.markdownPath,
    jsonPath: options.jsonPath,
  });
  const report = pruneUndefined({
    schemaVersion: SOAK_STABILITY_REPORT_SCHEMA_VERSION,
    suite: 'superapp-soak',
    target: source.target || options.target || 'superapp',
    profile: profile?.id || source.profile || 'unknown',
    status,
    classification: classifyStatus(status),
    startedAt: source.startedAt || options.startedAt,
    finishedAt: source.finishedAt || options.finishedAt,
    durationMs: finiteNumber(source.durationMs ?? metricsSummary.durationMs),
    observedStabilityEnvelope,
    thresholds: drift.thresholds || options.thresholds || {},
    detectorSummary: drift.summary || summarizeDetectors(detectorResults),
    detectorResults,
    recommendations: createRecommendations({
      detectorResults,
      runnerStatus: source.status,
      source,
      status,
    }),
    provenance: {
      generatedAt: options.generatedAt || source.finishedAt || source.startedAt,
      runId:
        source.parameters?.runId ||
        source.detail?.runner?.runId ||
        options.runId ||
        undefined,
      sourcePath: options.sourcePath,
      artifactPaths: artifacts,
    },
  });

  return {
    markdown: renderSoakStabilityAppendix(report),
    report,
  };
}

function writeSoakStabilityReport(input = {}, options = {}) {
  const outputDir = path.resolve(options.outputDir || process.cwd());
  const jsonPath = path.resolve(
    options.jsonPath || path.join(outputDir, DEFAULT_JSON_ARTIFACT),
  );
  const markdownPath = path.resolve(
    options.markdownPath || path.join(outputDir, DEFAULT_MARKDOWN_APPENDIX),
  );
  const { markdown, report } = createSoakStabilityReport(input, {
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

function renderSoakStabilityAppendix(report) {
  const envelope = report.observedStabilityEnvelope;
  const lines = [
    '## SuperApp Soak Stability Appendix',
    '',
    `- Status: ${report.status} (${report.classification})`,
    `- Profile: ${report.profile}`,
    `- Target: ${report.target}`,
    `- Duration: ${formatDuration(report.durationMs)}`,
    `- Windows: ${envelope.windowCount} x ${formatDuration(envelope.windowMs)}`,
    '',
    '### Observed Stability Envelope',
    '',
    ...renderEnvelope(envelope),
    '',
    '### Thresholds Used',
    '',
    '```json',
    JSON.stringify(report.thresholds, null, 2),
    '```',
    '',
    '### Detector Results',
    '',
    table(
      ['Detector', 'Status', 'Classification', 'Observed', 'Remediation'],
      report.detectorResults.map(detector => [
        detector.id,
        detector.status,
        detector.classification,
        summarizeObserved(detector.observed),
        detector.remediationHint || '',
      ]),
    ),
    '',
    '### Recommended Fixes',
    '',
    ...renderRecommendations(report.recommendations),
    '',
    '### Artifacts And Provenance',
    '',
    ...renderArtifacts(report.provenance.artifactPaths),
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function normalizeMetricsSummary(source) {
  if (source.metrics?.windows || source.metrics?.totals) {
    return {
      schemaVersion: source.metrics.schemaVersion || source.schemaVersion,
      durationMs: source.durationMs,
      errorClasses: source.detail?.errorClasses || SOAK_ERROR_CLASSES,
      resetLedger: source.detail?.resetLedger,
      totals: source.metrics.totals || {},
      windowMs: source.parameters?.windowMs,
      windows: source.metrics.windows || [],
    };
  }
  if (source.windows || source.totals) {
    return {
      schemaVersion: source.schemaVersion,
      durationMs: source.durationMs,
      errorClasses: source.errorClasses || SOAK_ERROR_CLASSES,
      resetLedger: source.resetLedger,
      totals: source.totals || {},
      windowMs: source.windowMs,
      windows: source.windows || [],
    };
  }
  return {
    durationMs: source.durationMs,
    errorClasses: SOAK_ERROR_CLASSES,
    resetLedger: source.resetLedger,
    totals: source.totals || {},
    windowMs: source.windowMs,
    windows: [],
  };
}

function resolveReportProfile(source, options) {
  if (options.profile) {
    return options.profile;
  }
  const profileId =
    source.profile ||
    source.parameters?.profileId ||
    source.detail?.drift?.profileId ||
    options.profileId;
  if (!profileId || profileId === 'unknown') {
    return undefined;
  }
  try {
    return getSoakProfileDefinition(profileId);
  } catch (_error) {
    return { id: profileId };
  }
}

function createObservedStabilityEnvelope(input) {
  const windows = input.metricsSummary.windows || [];
  const totals = input.metricsSummary.totals || {};
  const parameters = input.parameters || {};

  return {
    profileId: input.profile?.id || input.source.profile || 'unknown',
    durationMs: finiteNumber(input.metricsSummary.durationMs),
    windowMs: finiteNumber(
      input.metricsSummary.windowMs ||
        windows[0]?.endedOffsetMs - windows[0]?.startedOffsetMs,
    ),
    windowCount: windows.length,
    concurrency: parameters.concurrency,
    scenarioMix: parameters.scenarioMix || input.profile?.scenarioMix || [],
    memory: {
      rss: summarizeWindowSignal(windows, window => window.memory?.rss),
      heapUsed: summarizeWindowSignal(
        windows,
        window => window.memory?.heapUsed,
      ),
      heapTotal: summarizeWindowSignal(
        windows,
        window => window.memory?.heapTotal,
      ),
    },
    latency: {
      p95Ms: summarizeWindowValues(windows, window => window.latency?.p95Ms),
      p99Ms: summarizeWindowValues(windows, window => window.latency?.p99Ms),
    },
    eventLoopDelay: {
      p95Ms: summarizeWindowValues(
        windows,
        window => window.eventLoopDelay?.p95Ms,
      ),
      p99Ms: summarizeWindowValues(
        windows,
        window => window.eventLoopDelay?.p99Ms,
      ),
    },
    openHandles: summarizeWindowSignal(windows, window => window.openHandles),
    requestThroughputPerSecond: summarizeWindowValues(
      windows,
      window => window.requests?.throughputPerSecond,
    ),
    errorRates: {
      total: summarizeWindowValues(windows, window => window.errors?.rate),
      byClass: summarizeErrorRates(windows, input.metricsSummary.errorClasses),
    },
    resets: {
      cadence: parameters.resetCadence || input.profile?.resetCadence,
      ledger: input.metricsSummary.resetLedger || totals.resets || {},
    },
  };
}

function normalizeDetectorResults(detectors) {
  return detectors
    .map(detector => ({
      id: detector.id,
      category: detector.category,
      signal: detector.signal,
      status: normalizeStatus(detector.status),
      classification: classifyStatus(detector.status),
      observed: detector.observed,
      thresholds: detector.thresholds,
      affectedWindowIds: detector.affectedWindowIds || [],
      remediationHint: detector.remediationHint,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createRecommendations(input) {
  const recommendations = input.detectorResults
    .filter(detector => detector.status !== 'passed')
    .map(detector => ({
      detectorId: detector.id,
      status: detector.status,
      classification: detector.classification,
      recommendation:
        detector.remediationHint ||
        'Collect the missing soak evidence and rerun the profile before treating this result as stable.',
      affectedWindowIds: detector.affectedWindowIds,
      observed: detector.observed,
    }));

  if (input.status === 'failed' && recommendations.length === 0) {
    recommendations.push({
      detectorId: 'soak.runner.status',
      status: 'failed',
      classification: 'fail',
      recommendation:
        'Inspect the soak runner summary, error samples, and request logs for non-chaos failures that occurred outside drift detectors.',
      affectedWindowIds: [],
      observed: {
        runnerStatus: input.runnerStatus,
        budgetFailures: input.source.budgetFailures || [],
      },
    });
  }

  if (input.status === 'unknown' && recommendations.length === 0) {
    recommendations.push({
      detectorId: 'soak.evidence.missing',
      status: 'unknown',
      classification: 'unknown',
      recommendation:
        'Collect populated soak metric windows, reset ledger evidence, and detector output before using this run as readiness proof.',
      affectedWindowIds: [],
      observed: {},
    });
  }

  return recommendations;
}

function normalizeArtifacts(input) {
  const artifacts = [...(input.source.artifacts || [])];
  if (input.sourcePath) {
    artifacts.push({ path: input.sourcePath, kind: 'source-summary' });
  }
  if (input.jsonPath) {
    artifacts.push({ path: input.jsonPath, kind: 'stability-report-json' });
  }
  if (input.markdownPath) {
    artifacts.push({
      path: input.markdownPath,
      kind: 'stability-report-markdown',
    });
  }
  return artifacts
    .map(artifact =>
      typeof artifact === 'string'
        ? { path: artifact }
        : {
            kind: artifact.kind,
            path: artifact.path,
          },
    )
    .filter(artifact => artifact.path)
    .sort((left, right) =>
      `${left.kind || ''}:${left.path}`.localeCompare(
        `${right.kind || ''}:${right.path}`,
      ),
    );
}

function summarizeWindowSignal(windows, selectSignal) {
  return summarizeWindowValues(windows, window => {
    const signal = selectSignal(window);
    if (signal === undefined || signal === null) {
      return undefined;
    }
    if (typeof signal === 'number') {
      return signal;
    }
    return signal.last ?? signal.mean ?? signal.max;
  });
}

function summarizeWindowValues(windows, selectValue) {
  const series = windows
    .map(window => ({
      id: window.id,
      value: readNumber(selectValue(window)),
    }))
    .filter(item => item.value !== undefined);
  if (series.length === 0) {
    return {
      count: 0,
      delta: 0,
      first: 0,
      growthPercent: 0,
      last: 0,
      max: 0,
      min: 0,
      peakWindowId: undefined,
    };
  }
  const first = series[0].value;
  const last = series[series.length - 1].value;
  const peak = series.reduce((best, item) =>
    item.value > best.value ? item : best,
  );
  const values = series.map(item => item.value);
  return {
    count: series.length,
    first: roundMetric(first),
    last: roundMetric(last),
    delta: roundMetric(last - first),
    growthPercent: first === 0 ? 0 : roundMetric((last - first) / first),
    min: roundMetric(Math.min(...values)),
    max: roundMetric(Math.max(...values)),
    peakWindowId: peak.id,
  };
}

function summarizeErrorRates(windows, errorClasses = SOAK_ERROR_CLASSES) {
  return Object.fromEntries(
    [...errorClasses]
      .sort()
      .map(errorClass => [
        errorClass,
        summarizeWindowValues(
          windows,
          window => window.errors?.byClass?.[errorClass]?.rate,
        ),
      ]),
  );
}

function summarizeDetectors(detectors) {
  const summary = {
    failed: 0,
    passed: 0,
    total: detectors.length,
    unknown: 0,
    warning: 0,
  };
  for (const detector of detectors) {
    summary[normalizeStatus(detector.status)] += 1;
  }
  return summary;
}

function renderEnvelope(envelope) {
  return [
    `- Memory RSS: ${formatSignal(envelope.memory.rss, 'bytes')}`,
    `- Heap used: ${formatSignal(envelope.memory.heapUsed, 'bytes')}`,
    `- Latency p95: ${formatSignal(envelope.latency.p95Ms, 'ms')}`,
    `- Latency p99: ${formatSignal(envelope.latency.p99Ms, 'ms')}`,
    `- Open handles: ${formatSignal(envelope.openHandles)}`,
    `- Error rate: ${formatSignal(envelope.errorRates.total, 'ratio')}`,
    `- Reset ledger: ${formatResetLedger(envelope.resets.ledger)}`,
  ];
}

function renderRecommendations(recommendations) {
  if (recommendations.length === 0) {
    return ['- No remediation recommended; all detector evidence passed.'];
  }
  return recommendations.map(
    recommendation =>
      `- ${recommendation.detectorId} (${recommendation.status}): ${recommendation.recommendation}`,
  );
}

function renderArtifacts(artifacts) {
  if (!artifacts || artifacts.length === 0) {
    return ['- No artifact paths were provided.'];
  }
  return artifacts.map(
    artifact => `- ${artifact.kind || 'artifact'}: ${artifact.path}`,
  );
}

function table(headers, rows) {
  const escapedHeaders = headers.map(escapeTableCell);
  const body = rows.map(row => row.map(escapeTableCell));
  return [
    `| ${escapedHeaders.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function summarizeObserved(observed) {
  if (!observed || Object.keys(observed).length === 0) {
    return '';
  }
  return JSON.stringify(observed);
}

function formatSignal(signal, unit) {
  if (!signal || signal.count === 0) {
    return 'no populated windows';
  }
  const suffix = unit ? ` ${unit}` : '';
  return `first ${signal.first}${suffix}, last ${signal.last}${suffix}, delta ${signal.delta}${suffix}, max ${signal.max}${suffix}`;
}

function formatResetLedger(ledger = {}) {
  return `attempts ${finiteNumber(ledger.attempts)}, failed ${finiteNumber(
    ledger.failed,
  )}, successRate ${roundMetric(finiteNumber(ledger.successRate))}`;
}

function formatDuration(value) {
  const ms = finiteNumber(value);
  if (ms >= 60_000 && ms % 60_000 === 0) {
    return `${ms / 60_000}m`;
  }
  if (ms >= 1_000 && ms % 1_000 === 0) {
    return `${ms / 1_000}s`;
  }
  return `${ms}ms`;
}

function escapeTableCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
}

function classifyStatus(status) {
  return STATUS_TO_CLASSIFICATION[normalizeStatus(status)] || 'unknown';
}

function normalizeStatus(status) {
  if (status === 'pass') {
    return 'passed';
  }
  if (status === 'fail') {
    return 'failed';
  }
  return ['failed', 'passed', 'unknown', 'warning'].includes(status)
    ? status
    : 'unknown';
}

function readNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMetric(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
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
      .filter(([_key, item]) => item !== undefined)
      .map(([key, item]) => [key, pruneUndefined(item)]),
  );
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--summary':
        parsed.summaryPath = requireValue(argv, ++index, arg);
        break;
      case '--output-dir':
        parsed.outputDir = requireValue(argv, ++index, arg);
        break;
      case '--json':
        parsed.jsonPath = requireValue(argv, ++index, arg);
        break;
      case '--markdown':
        parsed.markdownPath = requireValue(argv, ++index, arg);
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(
          `Unknown SuperApp soak stability report option: ${arg}`,
        );
    }
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.summaryPath) {
    throw new Error('--summary is required');
  }
  const sourcePath = path.resolve(options.summaryPath);
  const summary = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const outputDir =
    options.outputDir ||
    path.dirname(options.jsonPath || options.markdownPath || sourcePath);
  const result = writeSoakStabilityReport(summary, {
    jsonPath: options.jsonPath,
    markdownPath: options.markdownPath,
    outputDir,
    sourcePath,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        markdownPath: result.markdownPath,
        reportPath: result.reportPath,
        status: result.report.status,
      },
      null,
      2,
    )}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_JSON_ARTIFACT,
  DEFAULT_MARKDOWN_APPENDIX,
  SOAK_STABILITY_REPORT_SCHEMA_VERSION,
  createSoakStabilityReport,
  renderSoakStabilityAppendix,
  writeSoakStabilityReport,
};
