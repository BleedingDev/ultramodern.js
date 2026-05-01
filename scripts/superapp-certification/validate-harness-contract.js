#!/usr/bin/env node

const path = require('node:path');
const {
  createArtifactEnvelope,
  writeArtifactSummary,
} = require('./artifact-schema');
const {
  createMetricsSampler,
  reservePort,
  sampleProcessMetrics,
} = require('./production-server-controller');

const repoRoot = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const options = {
    outDir:
      process.env.SUPERAPP_TORTURE_HARNESS_ARTIFACT_DIR ||
      path.join('.modern', 'superapp-certification', 'torture-harness'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') {
      options.outDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.outDir = path.isAbsolute(options.outDir)
    ? options.outDir
    : path.resolve(repoRoot, options.outDir);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const metrics = createMetricsSampler();
  const port = await metrics.timed('reserve-port', () => reservePort());
  metrics.recordOperation('sample-process-metrics', 0, { ok: true });
  const processSample = sampleProcessMetrics('harness-contract');
  const metricsSummary = metrics.summary({
    reservedPort: port,
    processSample,
  });

  const summary = createArtifactEnvelope({
    suite: 'superapp-torture-harness-contract',
    target: 'superapp-portfolio',
    profile: 'release',
    dimensions: ['contract', 'performance'],
    parameters: {
      reservedPort: port,
    },
    budgets: {
      maxActiveHandles: 64,
    },
    warnings:
      Number(processSample.activeHandles || 0) > 64
        ? [`active handle count ${processSample.activeHandles} exceeds 64`]
        : [],
    metrics: metricsSummary,
    artifacts: ['summary.json'],
    observations: [
      'artifact envelope helper loaded',
      'production server controller helpers loaded',
      'metrics sampler recorded process and event-loop fields',
    ],
  });

  writeArtifactSummary(path.join(options.outDir, 'summary.json'), summary);
  if (summary.status === 'failed') {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
