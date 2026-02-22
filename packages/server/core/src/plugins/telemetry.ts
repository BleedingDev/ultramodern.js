import type {
  CoreMonitor,
  LogEvent,
  Metrics,
  MonitorEvent,
} from '@modern-js/types';
import type { ServerTelemetryUserConfig } from '../types/config';
import type { ServerPlugin } from '../types/plugins';
import type { Context, Next, ServerEnv } from '../types/server';

export type TelemetrySignalType = 'log' | 'metric' | 'trace';

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
  slo?: {
    queueUtilizationWarnThreshold?: number;
    queueDroppedWarnThreshold?: number;
    alertCooldownMs?: number;
    onAlert?: (alert: TelemetrySloAlert) => void;
  };
}

export type TelemetrySloAlertType = 'queue.utilization' | 'queue.drop';

export interface TelemetrySloAlert {
  timestamp: number;
  service: string;
  module: string;
  environment: string;
  type: TelemetrySloAlertType;
  value: number;
  threshold: number;
  queueDepth: number;
  queueCapacity: number;
  queueUtilization: number;
  totalDropped: number;
}

export interface TelemetryQueueStats {
  depth: number;
  capacity: number;
  utilization: number;
  pendingDropped: number;
  totalDropped: number;
}

export type TelemetryCanaryState = 'canary' | 'promoted' | 'rolled_back';
export type TelemetryCanaryAction = 'hold' | 'promote' | 'rollback';
export type TelemetryCanaryFailureReason =
  | 'queue_utilization'
  | 'queue_dropped'
  | 'unhealthy_exporter'
  | 'contract_gate_missing'
  | 'contract_gate_failed';

export interface TelemetryCanaryFailure {
  reason: TelemetryCanaryFailureReason;
  gate?: string;
  message?: string;
  threshold?: number;
  value?: number;
}

export interface TelemetryCanaryContractGateStatus {
  name: string;
  passed: boolean;
  reason?: string;
  updatedAt: number;
}

export interface TelemetryCanaryDecision {
  timestamp: number;
  action: TelemetryCanaryAction;
  state: TelemetryCanaryState;
  consecutiveHealthy: number;
  consecutiveFailures: number;
  failures: TelemetryCanaryFailure[];
  queueStats: TelemetryQueueStats;
  unhealthyExporterCount: number;
  contractGates: TelemetryCanaryContractGateStatus[];
}

export interface TelemetryCanaryOrchestratorOptions {
  registry: TelemetryRegistry;
  evaluationIntervalMs?: number;
  minConsecutiveHealthyEvaluations?: number;
  rollbackConsecutiveFailures?: number;
  maxQueueUtilization?: number;
  maxTotalDropped?: number;
  maxUnhealthyExporters?: number;
  requiredContractGates?: string[];
  onEvaluate?: (decision: TelemetryCanaryDecision) => void;
  onPromote?: (decision: TelemetryCanaryDecision) => void;
  onRollback?: (decision: TelemetryCanaryDecision) => void;
}

export interface TelemetryExporterHealthStatus {
  name: string;
  healthy: boolean;
  failures: number;
  lastError?: string;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

export class TelemetryStartupHealthError extends Error {
  readonly code = 'TELEMETRY_EXPORTER_STARTUP_HEALTH_FAILED';

  readonly failedExporters: TelemetryExporterHealthStatus[];

  constructor(failedExporters: TelemetryExporterHealthStatus[]) {
    super(
      `Telemetry startup health check failed for exporters: ${failedExporters.map(item => item.name).join(', ')}`,
    );
    this.name = 'TelemetryStartupHealthError';
    this.failedExporters = failedExporters;
  }
}

export interface OtlpExporterOptions {
  endpoint?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface VictoriaMetricsExporterOptions extends OtlpExporterOptions {
  metricPrefix?: string;
}

type TelemetryMetricsTags = Record<string, unknown>;

type TelemetryMetricsPrefixOrTags = string | TelemetryMetricsTags;

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
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

function parseTraceparent(
  header: string | undefined,
): Pick<TelemetryEnvelope, 'traceId' | 'spanId'> | undefined {
  if (!header) {
    return undefined;
  }

  const match = header.trim().match(TRACEPARENT_REGEX);
  if (!match) {
    return undefined;
  }

  const traceId = match[1]?.toLowerCase();
  const spanId = match[2]?.toLowerCase();
  if (!traceId || !spanId) {
    return undefined;
  }

  return {
    traceId,
    spanId,
  };
}

function extractError(args: unknown[]): TelemetryEnvelope['error'] | undefined {
  for (const arg of args) {
    if (arg instanceof Error) {
      return {
        name: arg.name,
        message: arg.message,
        stack: arg.stack,
      };
    }
  }

  return undefined;
}

function toTelemetryEnvelope(
  event: MonitorEvent,
  input: {
    service: string;
    module: string;
    environment: string;
    traceId?: string;
    spanId?: string;
    attributes?: Record<string, unknown>;
  },
): TelemetryEnvelope {
  const base: Pick<
    TelemetryEnvelope,
    | 'timestamp'
    | 'service'
    | 'module'
    | 'environment'
    | 'traceId'
    | 'spanId'
    | 'attributes'
  > = {
    timestamp: Date.now(),
    service: input.service,
    module: input.module,
    environment: input.environment,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.spanId ? { spanId: input.spanId } : {}),
    ...(input.attributes ? { attributes: input.attributes } : {}),
  };

  if (event.type === 'log') {
    const payload = event.payload as LogEvent['payload'];
    const args = payload.args || [];
    const signalType: TelemetrySignalType =
      payload.level === 'trace' ? 'trace' : 'log';
    return {
      ...base,
      signalType,
      name: payload.message,
      level: payload.level,
      attributes: {
        ...(base.attributes || {}),
        args,
      },
      error: extractError(args),
    };
  }

  if (event.type === 'timing') {
    return {
      ...base,
      signalType: 'metric',
      name: event.payload.name,
      value: event.payload.dur,
      unit: 'ms',
      tags: normalizeLabels(event.payload.tags),
      attributes: {
        ...(base.attributes || {}),
        desc: event.payload.desc,
        args: event.payload.args,
      },
    };
  }

  return {
    ...base,
    signalType: 'metric',
    name: event.payload.name,
    value: 1,
    unit: 'count',
    tags: normalizeLabels(event.payload.tags),
    attributes: {
      ...(base.attributes || {}),
      args: event.payload.args,
    },
  };
}

async function postWithTimeout(options: {
  endpoint: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  if (typeof (timer as NodeJS.Timeout).unref === 'function') {
    (timer as NodeJS.Timeout).unref();
  }

  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      body: options.body,
      headers: options.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Telemetry exporter request failed: ${response.status} ${response.statusText}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
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
  const timestampMs = envelope.timestamp;
  return `${metricName}${labelText} ${value} ${timestampMs}`;
}

export function createOtlpTelemetryExporter(
  options: OtlpExporterOptions = {},
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
  options: VictoriaMetricsExporterOptions = {},
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
  private readonly flushIntervalMs: number;
  private readonly flushTimer?: ReturnType<typeof setInterval>;
  private droppedCount = 0;
  private totalDroppedCount = 0;
  private flushing: Promise<void> | null = null;
  private readonly exporterHealth = new Map<
    string,
    TelemetryExporterHealthStatus
  >();
  private readonly queueUtilizationWarnThreshold: number;
  private readonly queueDroppedWarnThreshold: number;
  private readonly alertCooldownMs: number;
  private readonly onSloAlert?: (alert: TelemetrySloAlert) => void;
  private readonly lastSloAlertAt = new Map<TelemetrySloAlertType, number>();

  constructor(options: TelemetryRegistryOptions) {
    this.service = options.service;
    this.module = options.module;
    this.environment = options.environment;
    this.samplingRate = clamp(options.samplingRate ?? 1, 0, 1);
    this.maxBatchSize = Math.max(1, options.maxBatchSize ?? 50);
    this.maxQueueSize = Math.max(1, options.maxQueueSize ?? 1000);
    this.flushIntervalMs = Math.max(50, options.flushIntervalMs ?? 1000);
    this.redactionKeys = new Set(options.redactionKeys || []);
    this.queueUtilizationWarnThreshold = clamp(
      options.slo?.queueUtilizationWarnThreshold ?? 0.8,
      0,
      1,
    );
    this.queueDroppedWarnThreshold = Math.max(
      1,
      options.slo?.queueDroppedWarnThreshold ?? 1,
    );
    this.alertCooldownMs = Math.max(0, options.slo?.alertCooldownMs ?? 60_000);
    this.onSloAlert = options.slo?.onAlert;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    if (typeof (this.flushTimer as NodeJS.Timeout).unref === 'function') {
      (this.flushTimer as NodeJS.Timeout).unref();
    }
  }

  async register(exporter: TelemetryExporter) {
    this.exporters.push(exporter);
    this.exporterHealth.set(exporter.name, {
      name: exporter.name,
      healthy: true,
      failures: 0,
    });
    if (exporter.init) {
      try {
        await exporter.init({
          service: this.service,
          module: this.module,
          environment: this.environment,
        });
        this.markExporterHealthy(exporter.name);
      } catch (error) {
        this.markExporterFailure(exporter.name, error);
        throw error;
      }
    } else {
      this.markExporterHealthy(exporter.name);
    }
  }

  private getOrCreateExporterHealth(name: string) {
    const existing = this.exporterHealth.get(name);
    if (existing) {
      return existing;
    }

    const next: TelemetryExporterHealthStatus = {
      name,
      healthy: true,
      failures: 0,
    };
    this.exporterHealth.set(name, next);
    return next;
  }

  private markExporterHealthy(name: string) {
    const status = this.getOrCreateExporterHealth(name);
    status.healthy = true;
    status.lastSuccessAt = Date.now();
    status.lastError = undefined;
  }

  private markExporterFailure(name: string, error: unknown) {
    const status = this.getOrCreateExporterHealth(name);
    status.healthy = false;
    status.failures += 1;
    status.lastFailureAt = Date.now();
    status.lastError = error instanceof Error ? error.message : String(error);
  }

  private maybeEmitSloAlert(
    type: TelemetrySloAlertType,
    value: number,
    threshold: number,
  ) {
    if (!this.onSloAlert || value < threshold) {
      return;
    }

    const now = Date.now();
    const lastTimestamp = this.lastSloAlertAt.get(type) ?? 0;
    if (now - lastTimestamp < this.alertCooldownMs) {
      return;
    }

    this.lastSloAlertAt.set(type, now);
    const queueDepth = this.queue.length;

    try {
      this.onSloAlert({
        timestamp: now,
        service: this.service,
        module: this.module,
        environment: this.environment,
        type,
        value,
        threshold,
        queueDepth,
        queueCapacity: this.maxQueueSize,
        queueUtilization: queueDepth / this.maxQueueSize,
        totalDropped: this.totalDroppedCount,
      });
    } catch (_error) {
      // SLO alert hooks must never crash telemetry pipeline.
    }
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
      this.totalDroppedCount += 1;
      this.maybeEmitSloAlert(
        'queue.drop',
        this.totalDroppedCount,
        this.queueDroppedWarnThreshold,
      );
    }

    this.queue.push(redactedEnvelope);
    this.maybeEmitSloAlert(
      'queue.utilization',
      this.queue.length / this.maxQueueSize,
      this.queueUtilizationWarnThreshold,
    );

    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  enqueueMetric(input: {
    name: string;
    value: number;
    unit?: string;
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    tags?: Record<string, string>;
    attributes?: Record<string, unknown>;
  }) {
    this.enqueue({
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
      signalType: 'metric',
      name: input.name,
      value: input.value,
      unit: input.unit || 'count',
      traceId: input.traceId,
      spanId: input.spanId,
      parentSpanId: input.parentSpanId,
      tags: input.tags,
      attributes: input.attributes,
    });
  }

  enqueueLog(input: {
    name: string;
    level: string;
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    tags?: Record<string, string>;
    attributes?: Record<string, unknown>;
    error?: TelemetryEnvelope['error'];
  }) {
    this.enqueue({
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
      signalType: 'log',
      name: input.name,
      level: input.level,
      traceId: input.traceId,
      spanId: input.spanId,
      parentSpanId: input.parentSpanId,
      tags: input.tags,
      attributes: input.attributes,
      error: input.error,
    });
  }

  enqueueTrace(input: {
    name: string;
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    tags?: Record<string, string>;
    attributes?: Record<string, unknown>;
  }) {
    this.enqueue({
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
      signalType: 'trace',
      name: input.name,
      traceId: input.traceId,
      spanId: input.spanId,
      parentSpanId: input.parentSpanId,
      tags: input.tags,
      attributes: input.attributes,
    });
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

  private buildQueueDepthEnvelope(queueDepth: number): TelemetryEnvelope {
    return {
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
      signalType: 'metric',
      name: 'telemetry.queue.depth',
      value: queueDepth,
      unit: 'count',
      tags: {
        capacity: String(this.maxQueueSize),
      },
    };
  }

  private buildQueueUtilizationEnvelope(queueDepth: number): TelemetryEnvelope {
    return {
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
      signalType: 'metric',
      name: 'telemetry.queue.utilization',
      value: queueDepth / this.maxQueueSize,
      unit: 'ratio',
      tags: {
        capacity: String(this.maxQueueSize),
      },
    };
  }

  private async emitBatch(batch: TelemetryEnvelope[]) {
    const results = await Promise.allSettled(
      this.exporters.map(async exporter => {
        await exporter.emit(batch);
        return exporter.name;
      }),
    );

    for (const [index, result] of results.entries()) {
      const exporterName = this.exporters[index]?.name || `exporter-${index}`;
      if (result.status === 'rejected') {
        this.markExporterFailure(exporterName, result.reason);
        continue;
      }

      this.markExporterHealthy(exporterName);
    }
  }

  private buildStartupProbeEnvelope(): TelemetryEnvelope {
    return {
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
      signalType: 'log',
      name: 'telemetry.exporter.startup_probe',
      level: 'info',
      tags: {
        phase: 'startup',
      },
      attributes: {
        source: 'TelemetryRegistry',
      },
    };
  }

  async startupHealthCheck(options?: { failLoud?: boolean }) {
    if (this.exporters.length === 0) {
      return;
    }

    const probeBatch = [this.buildStartupProbeEnvelope()];
    const failedExporters: TelemetryExporterHealthStatus[] = [];

    await Promise.all(
      this.exporters.map(async exporter => {
        try {
          await exporter.emit(probeBatch);
          this.markExporterHealthy(exporter.name);
        } catch (error) {
          this.markExporterFailure(exporter.name, error);
          const status = this.exporterHealth.get(exporter.name);
          if (status) {
            failedExporters.push({ ...status });
          }
        }
      }),
    );

    if ((options?.failLoud ?? true) && failedExporters.length > 0) {
      throw new TelemetryStartupHealthError(failedExporters);
    }
  }

  getExporterHealth(): TelemetryExporterHealthStatus[] {
    return Array.from(this.exporterHealth.values()).map(item => ({
      ...item,
    }));
  }

  getQueueStats(): TelemetryQueueStats {
    return {
      depth: this.queue.length,
      capacity: this.maxQueueSize,
      utilization: this.queue.length / this.maxQueueSize,
      pendingDropped: this.droppedCount,
      totalDropped: this.totalDroppedCount,
    };
  }

  private async flushInternal() {
    const queueDepthBeforeFlush = this.queue.length;
    if (queueDepthBeforeFlush > 0) {
      this.queue.unshift(
        this.buildQueueUtilizationEnvelope(queueDepthBeforeFlush),
      );
      this.queue.unshift(this.buildQueueDepthEnvelope(queueDepthBeforeFlush));
    }

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

export class TelemetryCanaryOrchestrator {
  private readonly registry: TelemetryRegistry;
  private readonly evaluationIntervalMs: number;
  private readonly minConsecutiveHealthyEvaluations: number;
  private readonly rollbackConsecutiveFailures: number;
  private readonly maxQueueUtilization: number;
  private readonly maxTotalDropped: number;
  private readonly maxUnhealthyExporters: number;
  private readonly requiredContractGates: string[];
  private readonly onEvaluate?: (decision: TelemetryCanaryDecision) => void;
  private readonly onPromote?: (decision: TelemetryCanaryDecision) => void;
  private readonly onRollback?: (decision: TelemetryCanaryDecision) => void;
  private readonly contractGates = new Map<
    string,
    TelemetryCanaryContractGateStatus
  >();
  private state: TelemetryCanaryState = 'canary';
  private consecutiveHealthy = 0;
  private consecutiveFailures = 0;
  private evaluationTimer?: ReturnType<typeof setInterval>;

  constructor(options: TelemetryCanaryOrchestratorOptions) {
    this.registry = options.registry;
    this.evaluationIntervalMs = Math.max(
      250,
      options.evaluationIntervalMs ?? 15_000,
    );
    this.minConsecutiveHealthyEvaluations = Math.max(
      1,
      options.minConsecutiveHealthyEvaluations ?? 3,
    );
    this.rollbackConsecutiveFailures = Math.max(
      1,
      options.rollbackConsecutiveFailures ?? 2,
    );
    this.maxQueueUtilization = clamp(options.maxQueueUtilization ?? 0.8, 0, 1);
    this.maxTotalDropped = Math.max(0, options.maxTotalDropped ?? 0);
    this.maxUnhealthyExporters = Math.max(
      0,
      options.maxUnhealthyExporters ?? 0,
    );
    this.requiredContractGates = options.requiredContractGates || [];
    this.onEvaluate = options.onEvaluate;
    this.onPromote = options.onPromote;
    this.onRollback = options.onRollback;
  }

  setContractGate(name: string, passed: boolean, reason?: string) {
    this.contractGates.set(name, {
      name,
      passed,
      reason,
      updatedAt: Date.now(),
    });
  }

  setContractGates(
    gates: Record<string, boolean | { passed: boolean; reason?: string }>,
  ) {
    for (const [name, value] of Object.entries(gates)) {
      if (typeof value === 'boolean') {
        this.setContractGate(name, value);
        continue;
      }

      this.setContractGate(name, value.passed, value.reason);
    }
  }

  resetToCanary() {
    this.state = 'canary';
    this.consecutiveHealthy = 0;
    this.consecutiveFailures = 0;
  }

  private collectFailures(): {
    failures: TelemetryCanaryFailure[];
    queueStats: TelemetryQueueStats;
    unhealthyExporterCount: number;
  } {
    const failures: TelemetryCanaryFailure[] = [];
    const queueStats = this.registry.getQueueStats();
    const unhealthyExporterCount = this.registry
      .getExporterHealth()
      .filter(item => !item.healthy).length;

    if (queueStats.utilization > this.maxQueueUtilization) {
      failures.push({
        reason: 'queue_utilization',
        threshold: this.maxQueueUtilization,
        value: queueStats.utilization,
      });
    }

    if (queueStats.totalDropped > this.maxTotalDropped) {
      failures.push({
        reason: 'queue_dropped',
        threshold: this.maxTotalDropped,
        value: queueStats.totalDropped,
      });
    }

    if (unhealthyExporterCount > this.maxUnhealthyExporters) {
      failures.push({
        reason: 'unhealthy_exporter',
        threshold: this.maxUnhealthyExporters,
        value: unhealthyExporterCount,
      });
    }

    for (const gateName of this.requiredContractGates) {
      const gate = this.contractGates.get(gateName);
      if (!gate) {
        failures.push({
          reason: 'contract_gate_missing',
          gate: gateName,
          message: `Contract gate "${gateName}" is missing`,
        });
        continue;
      }

      if (!gate.passed) {
        failures.push({
          reason: 'contract_gate_failed',
          gate: gateName,
          message: gate.reason || `Contract gate "${gateName}" is not passing`,
        });
      }
    }

    return {
      failures,
      queueStats,
      unhealthyExporterCount,
    };
  }

  evaluate(): TelemetryCanaryDecision {
    const now = Date.now();
    const { failures, queueStats, unhealthyExporterCount } =
      this.collectFailures();
    let action: TelemetryCanaryAction = 'hold';

    if (failures.length > 0) {
      this.consecutiveHealthy = 0;
      this.consecutiveFailures += 1;

      if (
        this.state !== 'rolled_back' &&
        this.consecutiveFailures >= this.rollbackConsecutiveFailures
      ) {
        this.state = 'rolled_back';
        action = 'rollback';
      }
    } else {
      this.consecutiveFailures = 0;
      this.consecutiveHealthy += 1;
      if (
        this.state === 'canary' &&
        this.consecutiveHealthy >= this.minConsecutiveHealthyEvaluations
      ) {
        this.state = 'promoted';
        action = 'promote';
      }
    }

    const decision: TelemetryCanaryDecision = {
      timestamp: now,
      action,
      state: this.state,
      consecutiveHealthy: this.consecutiveHealthy,
      consecutiveFailures: this.consecutiveFailures,
      failures,
      queueStats,
      unhealthyExporterCount,
      contractGates: Array.from(this.contractGates.values()).map(item => ({
        ...item,
      })),
    };

    try {
      this.onEvaluate?.(decision);
    } catch (_error) {
      // canary observer hooks must never crash server.
    }

    if (action === 'promote') {
      try {
        this.onPromote?.(decision);
      } catch (_error) {
        // canary observer hooks must never crash server.
      }
    }

    if (action === 'rollback') {
      try {
        this.onRollback?.(decision);
      } catch (_error) {
        // canary observer hooks must never crash server.
      }
    }

    return decision;
  }

  start() {
    if (this.evaluationTimer) {
      return;
    }
    this.evaluationTimer = setInterval(() => {
      this.evaluate();
    }, this.evaluationIntervalMs);
    if (typeof (this.evaluationTimer as NodeJS.Timeout).unref === 'function') {
      (this.evaluationTimer as NodeJS.Timeout).unref();
    }
  }

  stop() {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = undefined;
    }
  }
}

function normalizeMetricsInput(
  prefixOrTags?: TelemetryMetricsPrefixOrTags,
  tags?: TelemetryMetricsTags,
) {
  if (typeof prefixOrTags === 'string') {
    return {
      prefix: prefixOrTags,
      tags: tags || {},
    };
  }

  if (isRecord(prefixOrTags)) {
    return {
      prefix: undefined,
      tags: prefixOrTags,
    };
  }

  return {
    prefix: undefined,
    tags: tags || {},
  };
}

function normalizeMetricName(name: string, prefix: string | undefined) {
  return prefix && prefix.length > 0 ? `${prefix}.${name}` : name;
}

function toTelemetryMetricTags(tags: TelemetryMetricsTags) {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null) {
      continue;
    }
    output[key] = String(value);
  }
  return output;
}

function getTraceContext(tags: TelemetryMetricsTags) {
  const traceId =
    typeof tags.trace_id === 'string'
      ? tags.trace_id
      : typeof tags.traceId === 'string'
        ? tags.traceId
        : undefined;

  const spanId =
    typeof tags.span_id === 'string'
      ? tags.span_id
      : typeof tags.spanId === 'string'
        ? tags.spanId
        : undefined;

  const parentSpanId =
    typeof tags.parent_span_id === 'string'
      ? tags.parent_span_id
      : typeof tags.parentSpanId === 'string'
        ? tags.parentSpanId
        : undefined;

  return {
    traceId,
    spanId,
    parentSpanId,
  };
}

export const createTelemetryAwareMetrics = <T extends Metrics>(
  baseMetrics: T,
  registry: TelemetryRegistry,
): T => {
  const emitCounter: Metrics['emitCounter'] = (
    name,
    value,
    prefixOrTags,
    tags,
  ) => {
    const normalized = normalizeMetricsInput(
      prefixOrTags as TelemetryMetricsPrefixOrTags | undefined,
      tags,
    );
    baseMetrics.emitCounter(name, value, normalized.prefix, normalized.tags);

    try {
      const metricName = normalizeMetricName(name, normalized.prefix);
      const traceContext = getTraceContext(normalized.tags);
      registry.enqueueMetric({
        name: metricName,
        value,
        unit: 'count',
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        parentSpanId: traceContext.parentSpanId,
        tags: toTelemetryMetricTags(normalized.tags),
        attributes: normalized.tags,
      });
    } catch (_error) {
      // telemetry wrapping must never break request metrics.
    }
  };

  const emitTimer: Metrics['emitTimer'] = (name, value, prefixOrTags, tags) => {
    const normalized = normalizeMetricsInput(
      prefixOrTags as TelemetryMetricsPrefixOrTags | undefined,
      tags,
    );
    baseMetrics.emitTimer(name, value, normalized.prefix, normalized.tags);

    try {
      const metricName = normalizeMetricName(name, normalized.prefix);
      const traceContext = getTraceContext(normalized.tags);
      registry.enqueueMetric({
        name: metricName,
        value,
        unit: 'ms',
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        parentSpanId: traceContext.parentSpanId,
        tags: toTelemetryMetricTags(normalized.tags),
        attributes: normalized.tags,
      });
    } catch (_error) {
      // telemetry wrapping must never break request metrics.
    }
  };

  return {
    ...baseMetrics,
    emitCounter,
    emitTimer,
  };
};

export const hasEnabledTelemetryExporters = (
  config: ServerTelemetryUserConfig | undefined,
) =>
  Boolean(
    config?.exporters?.otlp?.enabled ||
      config?.exporters?.victoriaMetrics?.enabled,
  );

export const injectTelemetryPlugin = (): ServerPlugin => ({
  name: '@modern-js/inject-telemetry',
  setup(api) {
    const serverConfig = api.getServerConfig();
    const telemetryConfig = serverConfig?.server?.telemetry;
    if (!telemetryConfig) {
      return;
    }

    if (
      telemetryConfig.enabled !== true &&
      !hasEnabledTelemetryExporters(telemetryConfig)
    ) {
      return;
    }

    const { middlewares, metaName } = api.getServerContext();
    const registry = new TelemetryRegistry({
      service: telemetryConfig.service || metaName || 'modern-js',
      module: telemetryConfig.module || 'server',
      environment:
        telemetryConfig.environment ||
        process.env.MODERN_ENV ||
        process.env.NODE_ENV ||
        'development',
      samplingRate: telemetryConfig.samplingRate,
      flushIntervalMs: telemetryConfig.flushIntervalMs,
      maxBatchSize: telemetryConfig.maxBatchSize,
      maxQueueSize: telemetryConfig.maxQueueSize,
      redactionKeys: telemetryConfig.redactionKeys,
    });

    if (telemetryConfig.exporters?.otlp?.enabled) {
      void registry.register(
        createOtlpTelemetryExporter(telemetryConfig.exporters.otlp),
      );
    }

    if (telemetryConfig.exporters?.victoriaMetrics?.enabled) {
      void registry.register(
        createVictoriaMetricsTelemetryExporter(
          telemetryConfig.exporters.victoriaMetrics,
        ),
      );
    }

    middlewares.push({
      name: 'inject-telemetry',
      handler: async (c: Context<ServerEnv>, next: Next) => {
        const monitors = c.get('monitors');
        if (monitors) {
          const traceContext = parseTraceparent(c.req.header('traceparent'));
          const monitor: CoreMonitor = event => {
            registry.enqueue(
              toTelemetryEnvelope(event, {
                service: telemetryConfig.service || metaName || 'modern-js',
                module: telemetryConfig.module || 'server',
                environment:
                  telemetryConfig.environment ||
                  process.env.MODERN_ENV ||
                  process.env.NODE_ENV ||
                  'development',
                traceId: traceContext?.traceId,
                spanId: traceContext?.spanId,
                attributes: {
                  requestMethod: c.req.method,
                  requestPath: c.req.path,
                },
              }),
            );
          };
          monitors.push(monitor);
        }

        await next();
      },
    });
  },
});
