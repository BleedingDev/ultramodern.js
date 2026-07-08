#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { SUPERAPP_READINESS_DIMENSIONS } = require('../lib/artifact-schema');
const { parseCliArgs } = require('../lib/cli-kit');
const { writeJsonFile } = require('../lib/fs-kit');

const repoRoot = path.resolve(__dirname, '../..');
const dimensions = [...SUPERAPP_READINESS_DIMENSIONS];

function parseArgs(argv) {
  const options = parseCliArgs(argv, {
    defaults: {
      inputDir:
        process.env.SUPERAPP_READINESS_INPUT_DIR ||
        path.join('.modern', 'superapp-certification'),
      outDir:
        process.env.SUPERAPP_READINESS_OUT_DIR ||
        path.join('.modern', 'superapp-certification'),
      summaries: [],
    },
    ignoreTerminator: true,
    options: {
      'input-dir': {
        key: 'inputDir',
        requiredValue: false,
      },
      'out-dir': {
        key: 'outDir',
        requiredValue: false,
      },
      summary: {
        key: 'summaries',
        multiple: true,
        requiredValue: false,
      },
    },
  });

  options.inputDir = path.resolve(repoRoot, options.inputDir);
  options.outDir = path.resolve(repoRoot, options.outDir);
  options.summaries = options.summaries.map(summary =>
    path.resolve(repoRoot, summary),
  );
  return options;
}

function walkSummaryFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === 'summary.json') {
        files.push(entryPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function readSummaries(options) {
  const files = new Set([
    ...walkSummaryFiles(options.inputDir),
    ...options.summaries,
  ]);
  const summaries = [];
  for (const file of files) {
    try {
      summaries.push({
        file,
        summary: JSON.parse(fs.readFileSync(file, 'utf8')),
      });
    } catch (error) {
      summaries.push({
        file,
        summary: undefined,
        readError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summaries;
}

function commandDimensions(id) {
  const mappings = [
    [/^(lint|changeset|package-json|dependencies)$/, ['contract']],
    [/superapp-(erp|portfolio)-smoke/, ['integration']],
    [/stress/, ['stress', 'performance']],
    [/soak|nightly/, ['soak', 'performance']],
    [/browser-matrix/, ['browser']],
    [/mf-certification/, ['module-federation']],
    [/security/, ['security']],
  ];
  return mappings
    .filter(([pattern]) => pattern.test(id))
    .flatMap(([, mapped]) => mapped);
}

function suiteDimensions(summary) {
  const suite = String(summary?.suite || '');
  const mappings = [
    [/security/, ['security']],
    [/mf|module-federation/, ['module-federation']],
    [/browser/, ['browser']],
    [/pilot|chaos/, ['integration', 'stress', 'performance']],
    [/stress/, ['stress', 'performance']],
    [/soak|nightly/, ['soak', 'performance']],
    [/portfolio|erp/, ['integration']],
  ];
  return mappings
    .filter(([pattern]) => pattern.test(suite))
    .flatMap(([, mapped]) => mapped);
}

function summaryDimensions(summary) {
  const explicitDimensions = Array.isArray(summary?.dimensions)
    ? summary.dimensions.filter(dimension => dimensions.includes(dimension))
    : [];
  return [...new Set([...explicitDimensions, ...suiteDimensions(summary)])];
}

function normalizeCommandStatus(command) {
  if (command.status === 'planned') {
    return 'planned';
  }
  if (command.status === 'skipped') {
    return 'skipped';
  }
  return command.exitCode === 0 ? 'passed' : 'failed';
}

function normalizeSummaryStatus(summary) {
  const failureCount =
    Number(summary.failedCount || 0) +
    Number(summary.failedCommandCount || 0) +
    Number(summary.unexpectedErrorCount || 0) +
    (Array.isArray(summary.budgetFailures) ? summary.budgetFailures.length : 0);
  if (summary.status === 'failed' || failureCount > 0) {
    return 'failed';
  }
  if (summary.status === 'warning') {
    return 'warning';
  }
  if (summary.status === 'unknown' || summary.status === 'skipped') {
    return 'skipped';
  }
  if (summary.dryRun) {
    return 'planned';
  }
  return 'passed';
}

function normalizeDriftStatus(upstreamDrift) {
  if (!upstreamDrift) {
    return 'missing';
  }
  if (upstreamDrift.status === 'planned') {
    return 'planned';
  }
  if (upstreamDrift.status === 'skipped') {
    return 'skipped';
  }
  if (upstreamDrift.status === 'merged') {
    return 'passed';
  }
  return 'failed';
}

function normalizeNestedEvidenceStatus(entry) {
  switch (entry?.status) {
    case 'passed':
    case 'warning':
    case 'failed':
    case 'planned':
    case 'skipped':
      return entry.status;
    case 'pass':
      return 'passed';
    case 'fail':
      return 'failed';
    case 'unknown':
      return 'skipped';
    default:
      return 'failed';
  }
}

function nestedEvidenceDimensions(entry, summary) {
  const explicitDimensions = Array.isArray(entry?.dimensions)
    ? entry.dimensions.filter(dimension => dimensions.includes(dimension))
    : [];
  if (explicitDimensions.length > 0) {
    return [...new Set(explicitDimensions)];
  }
  return summaryDimensions(summary);
}

function nestedEvidenceReason(entry) {
  if (typeof entry?.reason === 'string' && entry.reason.length > 0) {
    return entry.reason;
  }
  if (typeof entry?.message === 'string' && entry.message.length > 0) {
    return entry.message;
  }
  return undefined;
}

function nestedEvidenceFromSummary(summary, relativeSource, parentId) {
  if (!Array.isArray(summary?.evidence)) {
    return [];
  }
  return summary.evidence
    .filter(entry => entry && typeof entry === 'object')
    .map((entry, index) => {
      const status = normalizeNestedEvidenceStatus(entry);
      const detail =
        entry.detail && typeof entry.detail === 'object' ? entry.detail : {};
      const item = {
        id:
          typeof entry.id === 'string' && entry.id.length > 0
            ? entry.id
            : `${parentId}:evidence:${index + 1}`,
        dimensions: nestedEvidenceDimensions(entry, summary),
        status,
        source: relativeSource,
        parentId,
        detail,
      };
      const reason = nestedEvidenceReason(entry);
      if (reason) {
        item.reason = reason;
      } else if (status === 'skipped') {
        item.reason = 'Nested evidence skipped without a reason.';
      }
      return item;
    });
}

function evidenceFromSummaries(summaries, inputDir) {
  const evidence = [];
  for (const item of summaries) {
    if (!item.summary) {
      evidence.push({
        id: `read-error:${path.basename(item.file)}`,
        dimensions: [],
        status: 'failed',
        source: path.relative(repoRoot, item.file),
        detail: {
          readError: item.readError,
        },
      });
      continue;
    }

    const relativeSource = path.relative(repoRoot, item.file);
    if (item.summary.suite === 'superapp-certification') {
      for (const command of item.summary.commands || []) {
        evidence.push({
          id: command.id,
          dimensions: commandDimensions(command.id),
          status: normalizeCommandStatus(command),
          source: relativeSource,
          detail: {
            command:
              command.label ||
              [command.command, ...(command.args || [])]
                .filter(Boolean)
                .join(' '),
            durationMs: command.durationMs,
            profile: command.profile,
          },
        });
      }
      evidence.push({
        id: 'upstream-drift',
        dimensions: ['upstream-drift'],
        status: normalizeDriftStatus(item.summary.upstreamDrift),
        source: relativeSource,
        detail: item.summary.upstreamDrift || {},
      });
      evidence.push(
        ...nestedEvidenceFromSummary(
          item.summary,
          relativeSource,
          item.summary.suite,
        ),
      );
      continue;
    }

    const summaryId = item.summary.suite || path.relative(inputDir, item.file);
    evidence.push({
      id: summaryId,
      dimensions: summaryDimensions(item.summary),
      status: normalizeSummaryStatus(item.summary),
      source: relativeSource,
      detail: {
        checkCount: item.summary.checkCount,
        failedCount: item.summary.failedCount,
        requestCount: item.summary.requestCount,
        unexpectedErrorCount: item.summary.unexpectedErrorCount,
      },
    });
    evidence.push(
      ...nestedEvidenceFromSummary(item.summary, relativeSource, summaryId),
    );
  }
  return evidence;
}

function dimensionStatus(items) {
  if (items.some(item => item.status === 'failed')) {
    return 'failed';
  }
  if (items.some(item => item.status === 'skipped')) {
    return 'skipped';
  }
  if (items.some(item => item.status === 'warning')) {
    return 'warning';
  }
  if (items.some(item => item.status === 'passed')) {
    return 'passed';
  }
  if (items.some(item => item.status === 'planned')) {
    return 'planned';
  }
  return 'missing';
}

function createReadiness(evidence) {
  const byDimension = Object.fromEntries(
    dimensions.map(dimension => {
      const items = evidence.filter(item =>
        item.dimensions.includes(dimension),
      );
      return [
        dimension,
        {
          status: dimensionStatus(items),
          evidenceCount: items.length,
          evidence: items.map(item => item.id),
        },
      ];
    }),
  );
  const statuses = Object.values(byDimension).map(item => item.status);
  const overallStatus = statuses.includes('failed')
    ? 'not_ready'
    : statuses.includes('missing')
      ? 'incomplete'
      : statuses.some(status =>
            ['planned', 'skipped', 'warning'].includes(status),
          )
        ? 'provisional'
        : 'ready';

  return {
    overallStatus,
    dimensions: byDimension,
  };
}

function markdownReport(report) {
  const rows = dimensions
    .map(dimension => {
      const item = report.readiness.dimensions[dimension];
      return `| ${dimension} | ${item.status} | ${item.evidenceCount} | ${item.evidence.join(', ') || '-'} |`;
    })
    .join('\n');
  const sources = report.sources.map(source => `- ${source}`).join('\n');

  return `# SuperApp Readiness Report

- Generated: ${report.generatedAt}
- Overall: ${report.readiness.overallStatus}
- Evidence files: ${report.sources.length}

| Dimension | Status | Evidence Count | Evidence |
| --- | --- | ---: | --- |
${rows}

## Sources

${sources || '- none'}
`;
}

function writeReport(options, summaries, evidence, readiness) {
  fs.mkdirSync(options.outDir, { recursive: true });
  const report = {
    schemaVersion: 1,
    suite: 'superapp-readiness-report',
    generatedAt: new Date().toISOString(),
    inputDir: path.relative(repoRoot, options.inputDir),
    sources: summaries.map(item => path.relative(repoRoot, item.file)),
    readiness,
    evidence,
  };
  const latestPath = path.join(options.outDir, 'latest.json');
  const markdownPath = path.join(options.outDir, 'readiness.md');
  writeJsonFile(latestPath, report, { atomic: false });
  fs.writeFileSync(markdownPath, markdownReport(report));
  console.log(`[superapp-readiness] latest: ${latestPath}`);
  console.log(`[superapp-readiness] markdown: ${markdownPath}`);
  return report;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const summaries = readSummaries(options);
  const evidence = evidenceFromSummaries(summaries, options.inputDir);
  const readiness = createReadiness(evidence);
  writeReport(options, summaries, evidence, readiness);
  if (readiness.overallStatus === 'not_ready') {
    process.exitCode = 1;
  }
}

main();
