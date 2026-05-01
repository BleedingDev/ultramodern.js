#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const dimensions = [
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

function parseArgs(argv) {
  const options = {
    inputDir:
      process.env.SUPERAPP_READINESS_INPUT_DIR ||
      path.join('.modern', 'superapp-certification'),
    outDir:
      process.env.SUPERAPP_READINESS_OUT_DIR ||
      path.join('.modern', 'superapp-certification'),
    summaries: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--input-dir') {
      options.inputDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--input-dir=')) {
      options.inputDir = arg.slice('--input-dir='.length);
    } else if (arg === '--out-dir') {
      options.outDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length);
    } else if (arg === '--summary') {
      options.summaries.push(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--summary=')) {
      options.summaries.push(arg.slice('--summary='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

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
    [/torture-harness-contract/, ['contract', 'performance']],
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
    [/stress|load/, ['stress', 'performance']],
    [/soak|nightly/, ['soak', 'performance']],
    [/portfolio|erp/, ['integration']],
  ];
  return mappings
    .filter(([pattern]) => pattern.test(suite))
    .flatMap(([, mapped]) => mapped);
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
    Number(summary.unexpectedErrorCount || 0);
  if (failureCount > 0) {
    return 'failed';
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
            command: command.command,
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
      continue;
    }

    evidence.push({
      id: item.summary.suite || path.relative(inputDir, item.file),
      dimensions: suiteDimensions(item.summary),
      status: normalizeSummaryStatus(item.summary),
      source: relativeSource,
      detail: {
        checkCount: item.summary.checkCount,
        failedCount: item.summary.failedCount,
        requestCount: item.summary.requestCount,
        unexpectedErrorCount: item.summary.unexpectedErrorCount,
      },
    });
  }
  return evidence;
}

function dimensionStatus(items) {
  if (items.some(item => item.status === 'failed')) {
    return 'failed';
  }
  if (items.some(item => item.status === 'passed')) {
    return 'passed';
  }
  if (items.some(item => item.status === 'planned')) {
    return 'planned';
  }
  if (items.some(item => item.status === 'skipped')) {
    return 'skipped';
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
      : statuses.some(status => ['planned', 'skipped'].includes(status))
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
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);
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
