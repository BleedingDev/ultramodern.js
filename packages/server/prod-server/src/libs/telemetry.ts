import http from 'http';
import https from 'https';
import { URL } from 'url';
import type { Metrics } from '@modern-js/types';
import type {
  ServerTelemetryExporterOptions,
  ServerTelemetryUserConfig,
  ServerTelemetryVictoriaMetricsOptions,
} from '@modern-js/server-core';

export type TelemetrySignalType = 'metric' | 'log' | 'trace';

export interface TelemetryEnvelope {
  timestamp: number;
  service: string;
  module: string;
  environment: string;
  signalType: TelemetrySignalType;
  name: string;
  level?: string;
  value?: number;
  unit?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  tags?: Record<string, string>;
  attributes?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
}

export interface TelemetryExporter {
  name: string;
  init?: (context: {
    service: string;
    module: string;
    environment: string;
  }) => void | Promise<void>;
  emit: (batch: TelemetryEnvelope[]) => void | Promise<void>;
  flush?: () => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
}

export interface TelemetryRegistryOptions {
  service: string;
  module: string;
  environment: string;
  samplingRate?: number;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxQueueSize?: number;
  redactionKeys?: string[];
}

const DEFAULT_OTLP_ENDPOINT = 'http://127.0.0.1:4318/v1/logs';
const DEFAULT_VM_ENDPOINT = 'http://127.0.0.1:8428/api/v1/import/prometheus';
const DEFAULT_TIMEOUT_MS = 5_000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactObject(
  value: unknown,
  redactionKeys: Set<string>,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const output: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (redactionKeys.has(key)) {
      output[key] = '[REDACTED]';
      continue;
    }

    if (Array.isArray(nested)) {
      output[key] = nested.map(item => {
        if (isRecord(item)) {
          return redactObject(item, redactionKeys);
        }
        return item;
      });
      continue;
    }

    if (isRecord(nested)) {
      output[key] = redactObject(nested, redactionKeys);
      continue;
    }

    output[key] = nested;
  }

  return output;
}

function normalizeLabels(labels: Record<string, unknown> | undefined) {
  if (!labels) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined || value === null) {
      continue;
    }
    normalized[key] = String(value);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function sanitizeMetricName(value: string) {
  return value.replace(/[^a-zA-Z0-9_:]/g, '_').replace(/_+/g, '_');
}

function escapeLabelValue(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function resolveTraceContext(tags: Record<string, string> | undefined): {
  traceId?: string;
  spanId?: string;
} {
  if (!tags) {
    return {};
  }

  return {
    traceId: tags.trace_id || tags.traceId,
    spanId: tags.span_id || tags.spanId,
  };
}

function toPrometheusLine(
  envelope: TelemetryEnvelope,
  metricPrefix: string,
): string {
  const metricName = sanitizeMetricName(
    `${metricPrefix}_${envelope.signalType}_${envelope.name}`,
  );
  const labels: Record<string, string> = {
    service: envelope.service,
    module: envelope.module,
    environment: envelope.environment,
    ...(envelope.level ? { level: envelope.level } : {}),
    ...(envelope.traceId ? { trace_id: envelope.traceId } : {}),
    ...(envelope.spanId ? { span_id: envelope.spanId } : {}),
    ...(envelope.tags || {}),
  };

  const labelPairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `${sanitizeMetricName(key)}="${escapeLabelValue(value)}"`,
    );
  const labelText = labelPairs.length > 0 ? `{${labelPairs.join(',')}}` : '';
  const value =
    typeof envelope.value === 'number' && Number.isFinite(envelope.value)
      ? envelope.value
      : 1;
  return `${metricName}${labelText} ${value} ${envelope.timestamp}`;
}

async function postWithTimeout(options: {
  endpoint: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}) {
  const url = new URL(options.endpoint);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Telemetry exporter protocol is not supported: ${url.protocol}`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          ...options.headers,
          'content-length': Buffer.byteLength(options.body),
        },
      },
      res => {
        const statusCode = res.statusCode || 500;
        const statusMessage = res.statusMessage || '';
        res.resume();
        res.on('error', reject);
        res.on('end', () => {
          if (statusCode >= 200 && statusCode < 300) {
            resolve();
            return;
          }
          reject(
            new Error(
              `Telemetry exporter request failed: ${statusCode} ${statusMessage}`,
            ),
          );
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(options.timeoutMs, () => {
      req.destroy(
        new Error(
          `Telemetry exporter request timed out after ${options.timeoutMs}ms`,
        ),
      );
    });
    req.write(options.body);
    req.end();
  });
}

export function createOtlpTelemetryExporter(
  options: ServerTelemetryExporterOptions = {},
): TelemetryExporter {
  const endpoint = options.endpoint || DEFAULT_OTLP_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {}),
  };

  return {
    name: 'otlp',
    async emit(batch) {
      if (batch.length === 0) {
        return;
      }

      const body = JSON.stringify({
        resource: {
          service: batch[0]?.service,
          module: batch[0]?.module,
          environment: batch[0]?.environment,
        },
        emittedAt: Date.now(),
        events: batch,
      });

      await postWithTimeout({
        endpoint,
        body,
        headers,
        timeoutMs,
      });
    },
  };
}

export function createVictoriaMetricsTelemetryExporter(
  options: ServerTelemetryVictoriaMetricsOptions = {},
): TelemetryExporter {
  const endpoint = options.endpoint || DEFAULT_VM_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const metricPrefix = sanitizeMetricName(options.metricPrefix || 'modernjs');
  const headers = {
    'content-type': 'text/plain; version=0.0.4',
    ...(options.headers || {}),
  };

  return {
    name: 'victoria-metrics',
    async emit(batch) {
      if (batch.length === 0) {
        return;
      }

      const lines = batch.map(item => toPrometheusLine(item, metricPrefix));
      await postWithTimeout({
        endpoint,
        body: `${lines.join('\n')}\n`,
        headers,
        timeoutMs,
      });
    },
  };
}

export class TelemetryRegistry {
  private readonly exporters: TelemetryExporter[] = [];
  private readonly queue: TelemetryEnvelope[] = [];
  private readonly redactionKeys: Set<string>;
  private readonly service: string;
  private readonly module: string;
  private readonly environment: string;
  private readonly samplingRate: number;
  private readonly maxBatchSize: number;
  private readonly maxQueueSize: number;
  private readonly flushTimer?: ReturnType<typeof setInterval>;
  private droppedCount = 0;
  private flushing: Promise<void> | null = null;

  constructor(options: TelemetryRegistryOptions) {
    this.service = options.service;
    this.module = options.module;
    this.environment = options.environment;
    this.samplingRate = clamp(options.samplingRate ?? 1, 0, 1);
    this.maxBatchSize = Math.max(1, options.maxBatchSize ?? 50);
    this.maxQueueSize = Math.max(1, options.maxQueueSize ?? 1000);
    this.redactionKeys = new Set(options.redactionKeys || []);

    const flushIntervalMs = Math.max(50, options.flushIntervalMs ?? 1000);
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, flushIntervalMs);
    if (typeof (this.flushTimer as NodeJS.Timeout).unref === 'function') {
      (this.flushTimer as NodeJS.Timeout).unref();
    }
  }

  async register(exporter: TelemetryExporter) {
    this.exporters.push(exporter);
    if (exporter.init) {
      await exporter.init({
        service: this.service,
        module: this.module,
        environment: this.environment,
      });
    }
  }

  enqueueMetric(input: {
    name: string;
    value: number;
    unit?: string;
    tags?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    signalType?: TelemetrySignalType;
    level?: string;
  }) {
    const tags = normalizeLabels(input.tags);
    const traceContext = resolveTraceContext(tags);
    this.enqueue({
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
      signalType: input.signalType || 'metric',
      name: input.name,
      level: input.level,
      value: input.value,
      unit: input.unit,
      tags,
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      attributes: input.attributes,
    });
  }

  enqueue(envelope: TelemetryEnvelope) {
    if (this.samplingRate < 1 && Math.random() > this.samplingRate) {
      return;
    }

    const redactedEnvelope =
      this.redactionKeys.size > 0
        ? ({
            ...envelope,
            attributes: redactObject(envelope.attributes, this.redactionKeys),
          } as TelemetryEnvelope)
        : envelope;

    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      this.droppedCount += 1;
    }

    this.queue.push(redactedEnvelope);

    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  private buildDroppedEnvelope(droppedCount: number): TelemetryEnvelope {
    return {
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
      signalType: 'metric',
      name: 'telemetry.queue.dropped',
      value: droppedCount,
      unit: 'count',
      tags: {
        reason: 'queue_backpressure',
      },
    };
  }

  private async emitBatch(batch: TelemetryEnvelope[]) {
    const results = await Promise.allSettled(
      this.exporters.map(async exporter => exporter.emit(batch)),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        // Keep exporter failures non-fatal for request path.
      }
    }
  }

  private async flushInternal() {
    if (this.droppedCount > 0) {
      const droppedCount = this.droppedCount;
      this.droppedCount = 0;
      this.queue.unshift(this.buildDroppedEnvelope(droppedCount));
    }

    if (this.queue.length === 0) {
      return;
    }

    if (this.exporters.length === 0) {
      this.queue.length = 0;
      return;
    }

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.maxBatchSize);
      await this.emitBatch(batch);
    }

    await Promise.allSettled(
      this.exporters.map(async exporter => {
        if (exporter.flush) {
          await exporter.flush();
        }
      }),
    );
  }

  flush() {
    if (this.flushing) {
      return this.flushing;
    }

    this.flushing = this.flushInternal().finally(() => {
      this.flushing = null;
    });

    return this.flushing;
  }

  async shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    await this.flush();
    await Promise.allSettled(
      this.exporters.map(async exporter => {
        if (exporter.shutdown) {
          await exporter.shutdown();
        }
      }),
    );
  }
}

export const hasEnabledTelemetryExporters = (
  config: ServerTelemetryUserConfig | undefined,
) =>
  Boolean(
    config?.exporters?.otlp?.enabled ||
      config?.exporters?.victoriaMetrics?.enabled,
  );

export const createTelemetryAwareMetrics = (
  metrics: Metrics,
  registry: TelemetryRegistry,
): Metrics => ({
  gauges(...args: Parameters<Metrics['gauges']>) {
    metrics.gauges(...args);
  },
  emitCounter(name, value, tags) {
    metrics.emitCounter(name, value, tags);
    try {
      registry.enqueueMetric({
        name,
        value,
        unit: 'count',
        tags,
      });
    } catch (_err) {
      // ignore telemetry failures
    }
  },
  emitTimer(name, value, tags) {
    metrics.emitTimer(name, value, tags);
    try {
      registry.enqueueMetric({
        name,
        value,
        unit: 'ms',
        tags,
      });
    } catch (_err) {
      // ignore telemetry failures
    }
  },
});
