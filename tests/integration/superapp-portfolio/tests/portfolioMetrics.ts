import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

type Sample = {
  operation: string;
  durationMs: number;
  ok: boolean;
  error?: string;
};

export type PortfolioMetrics = ReturnType<typeof createPortfolioMetrics>;

export function createPortfolioMetrics(options: {
  suite: string;
  outputDir: string;
}) {
  const samples: Sample[] = [];
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();
  const startedAt = Date.now();

  return {
    async timed<T>(operation: string, run: () => Promise<T>) {
      const started = performance.now();
      try {
        const value = await run();
        samples.push({
          operation,
          durationMs: performance.now() - started,
          ok: true,
        });
        return value;
      } catch (error) {
        samples.push({
          operation,
          durationMs: performance.now() - started,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    write(extra: Record<string, unknown> = {}) {
      eventLoopDelay.disable();
      const summary = {
        schemaVersion: 1,
        suite: options.suite,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        requestCount: samples.length,
        unexpectedErrorCount: samples.filter(sample => !sample.ok).length,
        operations: summarize(samples),
        eventLoopDelay: {
          maxMs: eventLoopDelay.max / 1_000_000,
          p95Ms: eventLoopDelay.percentile(95) / 1_000_000,
        },
        ...extra,
      };
      mkdirSync(options.outputDir, { recursive: true });
      writeFileSync(
        path.join(options.outputDir, 'summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
      return summary;
    },
  };
}

function summarize(samples: Sample[]) {
  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    grouped.set(sample.operation, [
      ...(grouped.get(sample.operation) ?? []),
      sample,
    ]);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([operation, operationSamples]) => [
      operation,
      {
        count: operationSamples.length,
        maxMs: Math.max(...operationSamples.map(sample => sample.durationMs)),
        ok: operationSamples.filter(sample => sample.ok).length,
      },
    ]),
  );
}
