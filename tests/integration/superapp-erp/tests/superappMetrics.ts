import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

type DurationSample = {
  label: string;
  durationMs: number;
};

type MemorySample = {
  label: string;
  timestampMs: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};

type MetricsOptions = {
  appDir: string;
  suite: string;
  parameters?: Record<string, unknown>;
  budgets?: Record<string, unknown>;
};

export function parsePositiveInt(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

function sanitizeArtifactSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/-+/g, '-');
}

function summarizeDurations(samples: DurationSample[]) {
  const values = samples.map(sample => sample.durationMs);
  return {
    count: values.length,
    minMs: values.length === 0 ? 0 : Math.min(...values),
    maxMs: values.length === 0 ? 0 : Math.max(...values),
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
  };
}

function summarizeMemory(samples: MemorySample[]) {
  const max = (key: keyof Omit<MemorySample, 'label' | 'timestampMs'>) =>
    samples.length === 0
      ? 0
      : Math.max(...samples.map(sample => Number(sample[key])));

  return {
    count: samples.length,
    maxRss: max('rss'),
    maxHeapUsed: max('heapUsed'),
    maxHeapTotal: max('heapTotal'),
    maxExternal: max('external'),
    maxArrayBuffers: max('arrayBuffers'),
  };
}

function resolveOutputDir(appDir: string, runId: string) {
  const repoRoot = path.resolve(appDir, '../../..');
  const configuredDir = process.env.SUPERAPP_ERP_ARTIFACT_DIR;

  if (configuredDir) {
    return path.isAbsolute(configuredDir)
      ? configuredDir
      : path.join(repoRoot, configuredDir);
  }

  return path.join(repoRoot, '.modern/superapp-runs', runId);
}

export function createSuperAppRunMetrics(options: MetricsOptions) {
  const startedAt = Date.now();
  const runId = sanitizeArtifactSegment(
    process.env.SUPERAPP_ERP_RUN_ID ||
      `${options.suite}-${new Date(startedAt).toISOString()}-${process.pid}`,
  );
  const outputDir = resolveOutputDir(options.appDir, runId);
  const durationSamples: DurationSample[] = [];
  const routeSamples: DurationSample[] = [];
  const memorySamples: MemorySample[] = [];
  const browserErrors: string[] = [];
  const invariants: Record<string, unknown> = {};
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  let summaryWritten = false;
  eventLoopDelay.enable();

  const recordMemory = (label: string) => {
    memorySamples.push({
      label,
      timestampMs: Date.now(),
      ...process.memoryUsage(),
    });
  };

  const recordDuration = (label: string, durationMs: number) => {
    durationSamples.push({ label, durationMs });
  };

  const recordRouteDuration = (label: string, durationMs: number) => {
    routeSamples.push({ label, durationMs });
  };

  const timed = async <T>(
    label: string,
    operation: () => Promise<T>,
    options?: { route?: boolean },
  ) => {
    const started = performance.now();
    const value = await operation();
    const durationMs = performance.now() - started;
    if (options?.route) {
      recordRouteDuration(label, durationMs);
    } else {
      recordDuration(label, durationMs);
    }
    return { value, durationMs };
  };

  const recordBrowserErrors = (errors: string[]) => {
    browserErrors.splice(0, browserErrors.length, ...errors);
  };

  const recordInvariant = (name: string, value: unknown) => {
    invariants[name] = value;
  };

  const writeSummary = (extra: Record<string, unknown> = {}) => {
    if (summaryWritten) {
      return {
        outputDir,
        summaryPath: path.join(outputDir, 'summary.json'),
      };
    }

    eventLoopDelay.disable();
    recordMemory('finish');
    const finishedAt = Date.now();
    const byLabel = Object.fromEntries(
      [...new Set(durationSamples.map(sample => sample.label))].map(label => [
        label,
        summarizeDurations(
          durationSamples.filter(sample => sample.label === label),
        ),
      ]),
    );
    const routeByLabel = Object.fromEntries(
      [...new Set(routeSamples.map(sample => sample.label))].map(label => [
        label,
        summarizeDurations(
          routeSamples.filter(sample => sample.label === label),
        ),
      ]),
    );
    const summary = {
      schemaVersion: 1,
      suite: options.suite,
      runId,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      parameters: options.parameters ?? {},
      budgets: options.budgets ?? {},
      durations: {
        all: summarizeDurations(durationSamples),
        byLabel,
      },
      routes: {
        all: summarizeDurations(routeSamples),
        byLabel: routeByLabel,
      },
      memory: {
        samples: memorySamples,
        summary: summarizeMemory(memorySamples),
      },
      eventLoopDelay: {
        minMs: eventLoopDelay.min / 1_000_000,
        maxMs: eventLoopDelay.max / 1_000_000,
        meanMs: eventLoopDelay.mean / 1_000_000,
        p95Ms: eventLoopDelay.percentile(95) / 1_000_000,
        p99Ms: eventLoopDelay.percentile(99) / 1_000_000,
      },
      browserErrors,
      invariants,
      ...extra,
    };

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    summaryWritten = true;
    return {
      outputDir,
      summary,
      summaryPath: path.join(outputDir, 'summary.json'),
    };
  };

  recordMemory('start');

  return {
    outputDir,
    recordBrowserErrors,
    recordDuration,
    recordInvariant,
    recordMemory,
    recordRouteDuration,
    timed,
    writeSummary,
  };
}
