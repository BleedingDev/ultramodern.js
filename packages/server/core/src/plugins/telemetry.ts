import type {
  CoreMonitor,
  LogEvent,
  Metrics,
  MonitorEvent,
} from '@modern-js/types';
import type { ServerTelemetryUserConfig } from '../types/config';
import type { ServerPlugin } from '../types/plugins';
import type { Context, Next, ServerEnv } from '../types/server';
import { ContractGateAutopilot } from './contractGateAutopilot';
import {
  CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
  type ContractGateSnapshotStore,
  DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH,
  type GateSnapshot,
  resolveContractGateSnapshotPath,
  resolveContractGateSnapshotStore,
} from './contractGateSnapshotStore';

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

export interface TelemetryCanaryStatusSnapshot {
  timestamp: number;
  state: TelemetryCanaryState;
  consecutiveHealthy: number;
  consecutiveFailures: number;
  queueStats: TelemetryQueueStats;
  unhealthyExporterCount: number;
  requiredContractGates: string[];
  contractGates: TelemetryCanaryContractGateStatus[];
  failurePreview: TelemetryCanaryFailure[];
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
export const DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT =
  '/_modern/contract-gates/runtime-fallback';
export const DEFAULT_RUNTIME_STATUS_ENDPOINT = '/_modern/runtime/status';
const DEFAULT_RUNTIME_FALLBACK_GATE_NAME = 'runtime-mf-fallback-health';
const DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS = 5 * 60_000;
const DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_RUNTIME_FALLBACK_AUTH_HEADER = 'x-modernjs-runtime-signal-token';
const DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW = 30;
const DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS = 60_000;
const DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS = 10_000;

export type RuntimeSignalErrorCode =
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'UNTRUSTED_SOURCE';

export type RuntimeSignalError = Error & {
  code?: RuntimeSignalErrorCode;
};

export type RuntimeFallbackSignalTrustPolicy = {
  allowedApps: string[];
  allowedEntryOrigins: string[];
  expectedRuntimeDigests: Record<string, string>;
  enforceRuntimeDigest: boolean;
  maxSignalsPerWindow: number;
  windowMs: number;
  dedupeWindowMs: number;
};

type RuntimeFallbackSignalRateLimitState = {
  count: number;
  windowStartedAt: number;
};

export type RuntimeFallbackSignalAuthConfig = {
  enabled: boolean;
  headerName: string;
  expectedValue?: string;
};

export type RuntimeFallbackSignalRuntimeState = {
  rateLimitBySource: Map<string, RuntimeFallbackSignalRateLimitState>;
  dedupeByFingerprint: Map<string, number>;
};

export type RuntimeFallbackSignalTrustContext = {
  trustPolicy: RuntimeFallbackSignalTrustPolicy;
  runtimeState: RuntimeFallbackSignalRuntimeState;
};

type RuntimeFallbackSignalConfig = {
  endpoint: string;
  gateName: string;
  gateSnapshotStore: Promise<ContractGateSnapshotStore>;
  failureHoldMs: number;
  maxBodyBytes: number;
  auth: RuntimeFallbackSignalAuthConfig;
  trustPolicy: RuntimeFallbackSignalTrustPolicy;
  runtimeState: RuntimeFallbackSignalRuntimeState;
};

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
  private requiredContractGates: string[] = [];
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
    this.setRequiredContractGates(options.requiredContractGates || []);
    this.onEvaluate = options.onEvaluate;
    this.onPromote = options.onPromote;
    this.onRollback = options.onRollback;
  }

  setRequiredContractGates(gates: string[]) {
    this.requiredContractGates = Array.from(
      new Set(gates.map(item => item.trim()).filter(Boolean)),
    );
  }

  addRequiredContractGate(name: string) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return;
    }

    if (!this.requiredContractGates.includes(normalizedName)) {
      this.requiredContractGates.push(normalizedName);
    }
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

  getStatusSnapshot(): TelemetryCanaryStatusSnapshot {
    const now = Date.now();
    const { failures, queueStats, unhealthyExporterCount } =
      this.collectFailures();
    return {
      timestamp: now,
      state: this.state,
      consecutiveHealthy: this.consecutiveHealthy,
      consecutiveFailures: this.consecutiveFailures,
      queueStats,
      unhealthyExporterCount,
      requiredContractGates: [...this.requiredContractGates],
      contractGates: Array.from(this.contractGates.values()).map(item => ({
        ...item,
      })),
      failurePreview: failures,
    };
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

export function resolveRuntimeFallbackSignalEndpoint(
  configuredEndpoint?: string,
) {
  const rawEndpoint = configuredEndpoint?.trim();
  if (!rawEndpoint) {
    return DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT;
  }

  if (rawEndpoint.startsWith('/')) {
    return rawEndpoint;
  }

  try {
    return (
      new URL(rawEndpoint).pathname || DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT
    );
  } catch (_error) {
    return `/${rawEndpoint.replace(/^\/+/, '')}`;
  }
}

export function createRuntimeSignalError(
  message: string,
  code: RuntimeSignalError['code'],
) {
  const error = new Error(message) as RuntimeSignalError;
  error.code = code;
  return error;
}

function getUtf8ByteLength(input: string) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(input);
  }
  return new TextEncoder().encode(input).length;
}

function normalizeRuntimeSignalOrigin(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch (_error) {
    return undefined;
  }
}

function normalizeRuntimeSignalAppName(payload: Record<string, unknown>) {
  if (typeof payload.appName !== 'string') {
    return 'unknown';
  }
  const normalized = payload.appName.trim();
  return normalized.length > 0 ? normalized : 'unknown';
}

function normalizeRuntimeSignalRuntimeDigest(payload: Record<string, unknown>) {
  if (
    typeof payload.runtimeDigest === 'string' &&
    payload.runtimeDigest.trim()
  ) {
    return payload.runtimeDigest.trim();
  }

  const metadata = payload.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).runtimeDigest === 'string'
  ) {
    const digest = String(
      (metadata as Record<string, unknown>).runtimeDigest,
    ).trim();
    if (digest) {
      return digest;
    }
  }

  return undefined;
}

export function normalizeRuntimeFallbackSignalAuthConfig(
  configured:
    | {
        enabled?: boolean;
        headerName?: string;
        expectedValue?: string;
        expectedValueEnv?: string;
      }
    | undefined,
): RuntimeFallbackSignalAuthConfig {
  const headerName =
    typeof configured?.headerName === 'string' && configured.headerName.trim()
      ? configured.headerName.trim().toLowerCase()
      : DEFAULT_RUNTIME_FALLBACK_AUTH_HEADER;
  const expectedFromEnv =
    typeof configured?.expectedValueEnv === 'string' &&
    configured.expectedValueEnv.trim().length > 0
      ? process.env[configured.expectedValueEnv.trim()]
      : undefined;
  const expectedFromConfig =
    typeof configured?.expectedValue === 'string' &&
    configured.expectedValue.trim().length > 0
      ? configured.expectedValue.trim()
      : undefined;
  const expectedValue = expectedFromConfig || expectedFromEnv;
  const enabled = configured?.enabled === true;

  if (enabled && !expectedValue) {
    throw new Error(
      '[telemetry.canary.autopilot.runtimeFallbackSignal] auth.enabled is true but no expected token is configured',
    );
  }

  return {
    enabled,
    headerName,
    expectedValue,
  };
}

export function enforceRuntimeFallbackSignalAuthToken(
  token: string | undefined,
  authConfig: RuntimeFallbackSignalAuthConfig,
) {
  if (!authConfig.enabled) {
    return;
  }

  if (!token || token !== authConfig.expectedValue) {
    throw createRuntimeSignalError(
      'runtime fallback signal auth failed',
      'UNAUTHORIZED',
    );
  }
}

function enforceRuntimeFallbackSignalAuth(
  c: Context<ServerEnv>,
  runtimeSignalConfig: RuntimeFallbackSignalConfig,
) {
  enforceRuntimeFallbackSignalAuthToken(
    c.req.header(runtimeSignalConfig.auth.headerName),
    runtimeSignalConfig.auth,
  );
}

export function normalizeRuntimeFallbackTrustPolicy(
  configured:
    | {
        allowedApps?: string[];
        allowedEntryOrigins?: string[];
        expectedRuntimeDigests?: Record<string, string>;
        enforceRuntimeDigest?: boolean;
        maxSignalsPerWindow?: number;
        windowMs?: number;
        dedupeWindowMs?: number;
      }
    | undefined,
): RuntimeFallbackSignalTrustPolicy {
  const allowedApps = Array.isArray(configured?.allowedApps)
    ? configured!.allowedApps
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];
  const allowedEntryOrigins = Array.isArray(configured?.allowedEntryOrigins)
    ? configured!.allowedEntryOrigins
        .map(item => normalizeRuntimeSignalOrigin(item))
        .filter((item): item is string => Boolean(item))
    : [];

  const expectedRuntimeDigestsRaw = configured?.expectedRuntimeDigests || {};
  const expectedRuntimeDigests: Record<string, string> = {};
  Object.entries(expectedRuntimeDigestsRaw).forEach(([appName, digest]) => {
    if (
      typeof appName === 'string' &&
      appName.trim().length > 0 &&
      typeof digest === 'string' &&
      digest.trim().length > 0
    ) {
      expectedRuntimeDigests[appName.trim()] = digest.trim();
    }
  });

  return {
    allowedApps,
    allowedEntryOrigins,
    expectedRuntimeDigests,
    enforceRuntimeDigest: configured?.enforceRuntimeDigest === true,
    maxSignalsPerWindow: Math.max(
      1,
      Math.floor(
        configured?.maxSignalsPerWindow ??
          DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW,
      ),
    ),
    windowMs: Math.max(
      1_000,
      Math.floor(
        configured?.windowMs ?? DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS,
      ),
    ),
    dedupeWindowMs: Math.max(
      0,
      Math.floor(
        configured?.dedupeWindowMs ??
          DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS,
      ),
    ),
  };
}

export function createRuntimeFallbackSignalRuntimeState(): RuntimeFallbackSignalRuntimeState {
  return {
    rateLimitBySource: new Map(),
    dedupeByFingerprint: new Map(),
  };
}

function cleanupRuntimeFallbackSignalRuntimeState(
  now: number,
  runtimeState: RuntimeFallbackSignalRuntimeState,
  trustPolicy: RuntimeFallbackSignalTrustPolicy,
) {
  const dedupeExpiryMs = Math.max(
    trustPolicy.dedupeWindowMs,
    trustPolicy.windowMs,
    1_000,
  );
  runtimeState.dedupeByFingerprint.forEach((lastSeenAt, fingerprint) => {
    if (now - lastSeenAt > dedupeExpiryMs) {
      runtimeState.dedupeByFingerprint.delete(fingerprint);
    }
  });

  runtimeState.rateLimitBySource.forEach((state, source) => {
    if (now - state.windowStartedAt > trustPolicy.windowMs * 2) {
      runtimeState.rateLimitBySource.delete(source);
    }
  });
}

export function enforceRuntimeFallbackSignalTrustPolicy(
  payload: Record<string, unknown>,
  runtimeSignalContext: RuntimeFallbackSignalTrustContext,
) {
  const { trustPolicy, runtimeState } = runtimeSignalContext;
  const now = Date.now();
  cleanupRuntimeFallbackSignalRuntimeState(now, runtimeState, trustPolicy);

  const appName = normalizeRuntimeSignalAppName(payload);
  const entryOrigin = normalizeRuntimeSignalOrigin(payload.entry);
  const runtimeDigest = normalizeRuntimeSignalRuntimeDigest(payload);

  if (
    trustPolicy.allowedApps.length > 0 &&
    !trustPolicy.allowedApps.includes(appName)
  ) {
    throw createRuntimeSignalError(
      `runtime fallback signal app "${appName}" is not trusted`,
      'UNTRUSTED_SOURCE',
    );
  }

  if (trustPolicy.allowedEntryOrigins.length > 0) {
    if (
      !entryOrigin ||
      !trustPolicy.allowedEntryOrigins.includes(entryOrigin)
    ) {
      throw createRuntimeSignalError(
        `runtime fallback signal entry origin "${entryOrigin || 'unknown'}" is not trusted`,
        'UNTRUSTED_SOURCE',
      );
    }
  }

  const expectedDigest = trustPolicy.expectedRuntimeDigests[appName];
  if (expectedDigest && runtimeDigest !== expectedDigest) {
    throw createRuntimeSignalError(
      `runtime fallback runtimeDigest mismatch for app "${appName}"`,
      'UNTRUSTED_SOURCE',
    );
  }

  if (trustPolicy.enforceRuntimeDigest && !runtimeDigest) {
    throw createRuntimeSignalError(
      `runtime fallback signal for app "${appName}" is missing runtimeDigest`,
      'UNTRUSTED_SOURCE',
    );
  }

  const dedupeFingerprint = JSON.stringify({
    appName,
    entryOrigin: entryOrigin || 'unknown',
    reason: payload.reason || 'runtime_fallback',
    phase: payload.phase || 'unknown',
    runtimeDigest: runtimeDigest || 'unknown',
  });
  const dedupeWindowMs = trustPolicy.dedupeWindowMs;
  if (dedupeWindowMs > 0) {
    const lastSeenAt = runtimeState.dedupeByFingerprint.get(dedupeFingerprint);
    runtimeState.dedupeByFingerprint.set(dedupeFingerprint, now);
    if (typeof lastSeenAt === 'number' && now - lastSeenAt <= dedupeWindowMs) {
      return {
        deduped: true,
      };
    }
  } else {
    runtimeState.dedupeByFingerprint.set(dedupeFingerprint, now);
  }

  const sourceKey = `${appName}@${entryOrigin || 'unknown'}`;
  const rateState = runtimeState.rateLimitBySource.get(sourceKey);
  if (!rateState || now - rateState.windowStartedAt > trustPolicy.windowMs) {
    runtimeState.rateLimitBySource.set(sourceKey, {
      count: 1,
      windowStartedAt: now,
    });
  } else {
    if (rateState.count >= trustPolicy.maxSignalsPerWindow) {
      throw createRuntimeSignalError(
        `runtime fallback signal rate-limited for source "${sourceKey}"`,
        'RATE_LIMITED',
      );
    }
    rateState.count += 1;
  }

  return {
    deduped: false,
  };
}

function maybeWarnLegacyOtlpEndpoint(endpoint: string | undefined) {
  if (!endpoint || !endpoint.includes('/v1/metrics')) {
    return;
  }
  // Keep this warning lightweight and runtime-safe.
  // eslint-disable-next-line no-console
  console.warn(
    `[telemetry] OTLP endpoint "${endpoint}" looks like a metrics path. UltraModern telemetry exporter expects log-style envelopes (default: ${DEFAULT_OTLP_ENDPOINT}).`,
  );
}

async function parseRuntimeFallbackSignalPayload(
  c: Context<ServerEnv>,
  maxBodyBytes: number,
) {
  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw createRuntimeSignalError(
        'runtime fallback signal payload too large',
        'PAYLOAD_TOO_LARGE',
      );
    }
  }

  const rawBody = await c.req.raw.text();
  const payload = parseRuntimeFallbackSignalPayloadFromRawBody(
    rawBody,
    maxBodyBytes,
  );
  return {
    rawBody,
    payload,
  };
}

export function parseRuntimeFallbackSignalPayloadFromRawBody(
  rawBody: string,
  maxBodyBytes: number,
) {
  if (!rawBody || rawBody.trim().length === 0) {
    throw createRuntimeSignalError(
      'runtime fallback signal body is empty',
      'INVALID_PAYLOAD',
    );
  }
  if (getUtf8ByteLength(rawBody) > maxBodyBytes) {
    throw createRuntimeSignalError(
      'runtime fallback signal payload too large',
      'PAYLOAD_TOO_LARGE',
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (_error) {
    throw createRuntimeSignalError(
      'runtime fallback signal body must be valid JSON',
      'INVALID_PAYLOAD',
    );
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createRuntimeSignalError(
      'runtime fallback signal body must be a JSON object',
      'INVALID_PAYLOAD',
    );
  }

  return payload as Record<string, unknown>;
}

export function getRuntimeSignalErrorStatusCode(
  signalError: RuntimeSignalError,
): 400 | 401 | 403 | 413 | 429 | 500 {
  if (signalError.code === 'PAYLOAD_TOO_LARGE') {
    return 413;
  }
  if (signalError.code === 'INVALID_PAYLOAD') {
    return 400;
  }
  if (signalError.code === 'UNAUTHORIZED') {
    return 401;
  }
  if (signalError.code === 'RATE_LIMITED') {
    return 429;
  }
  if (signalError.code === 'UNTRUSTED_SOURCE') {
    return 403;
  }
  return 500;
}

async function persistRuntimeFallbackContractGate(
  payload: Record<string, unknown>,
  runtimeSignalConfig: RuntimeFallbackSignalConfig,
) {
  const now = Date.now();
  const gateSnapshotStore = await runtimeSignalConfig.gateSnapshotStore;
  const snapshot: GateSnapshot = (await gateSnapshotStore.readSnapshot()) || {};
  const existingGates =
    snapshot.gates && typeof snapshot.gates === 'object' ? snapshot.gates : {};

  const reason =
    typeof payload.reason === 'string' ? payload.reason : 'runtime_fallback';
  const phase = typeof payload.phase === 'string' ? payload.phase : 'unknown';
  const appName =
    typeof payload.appName === 'string' ? payload.appName : 'unknown';
  const entry = typeof payload.entry === 'string' ? payload.entry : undefined;

  snapshot.schemaVersion =
    typeof snapshot.schemaVersion === 'number'
      ? snapshot.schemaVersion
      : CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION;
  snapshot.updatedAt = now;
  snapshot.gates = {
    ...existingGates,
    [runtimeSignalConfig.gateName]: {
      passed: false,
      reason: `runtime_fallback:${reason} phase=${phase} app=${appName}${entry ? ` entry=${entry}` : ''}`,
      updatedAt: now,
      expiresAt: now + runtimeSignalConfig.failureHoldMs,
      source: 'runtime-mf-fallback-signal',
      metadata: payload,
    },
  };

  await gateSnapshotStore.writeSnapshot(snapshot);
}

function emitCanaryDecisionMetric(
  registry: TelemetryRegistry,
  decision: TelemetryCanaryDecision,
  action: 'promote' | 'rollback',
) {
  try {
    registry.enqueueMetric({
      name: `telemetry.canary.${action}`,
      value: 1,
      unit: 'count',
      tags: {
        action,
        state: decision.state,
        failures: String(decision.failures.length),
      },
    });
  } catch (_error) {
    // Canary decision metrics are best-effort and must never break request flow.
  }
}

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

    const { middlewares, metaName, appDirectory } = api.getServerContext();
    const serviceName = telemetryConfig.service || metaName || 'modern-js';
    const moduleName = telemetryConfig.module || 'server';
    const environmentName =
      telemetryConfig.environment ||
      process.env.MODERN_ENV ||
      process.env.NODE_ENV ||
      'development';

    const registry = new TelemetryRegistry({
      service: serviceName,
      module: moduleName,
      environment: environmentName,
      samplingRate: telemetryConfig.samplingRate,
      flushIntervalMs: telemetryConfig.flushIntervalMs,
      maxBatchSize: telemetryConfig.maxBatchSize,
      maxQueueSize: telemetryConfig.maxQueueSize,
      redactionKeys: telemetryConfig.redactionKeys,
    });

    let canaryOrchestrator: TelemetryCanaryOrchestrator | undefined;
    let contractGateAutopilot: ContractGateAutopilot | undefined;
    let runtimeFallbackSignalConfig: RuntimeFallbackSignalConfig | undefined;
    let gateSnapshotStorePromise:
      | Promise<ContractGateSnapshotStore>
      | undefined;

    const canaryConfig = telemetryConfig.canary;
    if (canaryConfig?.enabled) {
      const contractGates = canaryConfig.contractGates as
        | Record<string, boolean | { passed: boolean; reason?: string }>
        | undefined;

      canaryOrchestrator = new TelemetryCanaryOrchestrator({
        registry,
        evaluationIntervalMs: canaryConfig.evaluationIntervalMs,
        minConsecutiveHealthyEvaluations:
          canaryConfig.minConsecutiveHealthyEvaluations,
        rollbackConsecutiveFailures: canaryConfig.rollbackConsecutiveFailures,
        maxQueueUtilization: canaryConfig.maxQueueUtilization,
        maxTotalDropped: canaryConfig.maxTotalDropped,
        maxUnhealthyExporters: canaryConfig.maxUnhealthyExporters,
        requiredContractGates: Object.keys(contractGates || {}),
        onPromote: decision => {
          emitCanaryDecisionMetric(registry, decision, 'promote');
        },
        onRollback: decision => {
          emitCanaryDecisionMetric(registry, decision, 'rollback');
        },
      });

      if (contractGates) {
        canaryOrchestrator.setContractGates(contractGates);
      }

      const autopilotEnabled = canaryConfig.autopilot?.enabled ?? true;
      if (autopilotEnabled) {
        const gateSnapshotPath = resolveContractGateSnapshotPath(
          appDirectory,
          canaryConfig.autopilot?.gateSnapshotPath,
        );
        gateSnapshotStorePromise = resolveContractGateSnapshotStore({
          appDirectory,
          gateSnapshotPath:
            gateSnapshotPath || DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH,
          stateStore: canaryConfig.autopilot?.stateStore,
        });

        const runtimeSignalConfig =
          canaryConfig.autopilot?.runtimeFallbackSignal;
        const runtimeSignalEnabled = runtimeSignalConfig?.enabled ?? true;
        if (runtimeSignalEnabled && gateSnapshotStorePromise) {
          runtimeFallbackSignalConfig = {
            endpoint: resolveRuntimeFallbackSignalEndpoint(
              runtimeSignalConfig?.endpoint,
            ),
            gateName:
              runtimeSignalConfig?.gateName?.trim() ||
              DEFAULT_RUNTIME_FALLBACK_GATE_NAME,
            gateSnapshotStore: gateSnapshotStorePromise,
            failureHoldMs: Math.max(
              1_000,
              runtimeSignalConfig?.failureHoldMs ??
                DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS,
            ),
            maxBodyBytes: Math.max(
              512,
              runtimeSignalConfig?.maxBodyBytes ??
                DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES,
            ),
            auth: normalizeRuntimeFallbackSignalAuthConfig(
              runtimeSignalConfig?.auth,
            ),
            trustPolicy: normalizeRuntimeFallbackTrustPolicy(
              runtimeSignalConfig?.trustPolicy,
            ),
            runtimeState: createRuntimeFallbackSignalRuntimeState(),
          };
        }
      }
    }

    if (runtimeFallbackSignalConfig) {
      const signalConfig = runtimeFallbackSignalConfig;
      middlewares.push({
        name: 'telemetry-runtime-fallback-signal',
        path: signalConfig.endpoint,
        method: 'post',
        order: 'pre',
        handler: async (c: Context<ServerEnv>) => {
          try {
            enforceRuntimeFallbackSignalAuth(c, signalConfig);
            const { payload } = await parseRuntimeFallbackSignalPayload(
              c,
              signalConfig.maxBodyBytes,
            );
            const trustResult = enforceRuntimeFallbackSignalTrustPolicy(
              payload,
              signalConfig,
            );
            if (trustResult.deduped) {
              return c.json({ ok: true, deduped: true }, 202);
            }
            await persistRuntimeFallbackContractGate(payload, signalConfig);
            return c.json({ ok: true }, 202);
          } catch (error) {
            const signalError = error as RuntimeSignalError;
            const status = getRuntimeSignalErrorStatusCode(signalError);
            return c.json(
              {
                ok: false,
                error:
                  signalError instanceof Error
                    ? signalError.message
                    : String(signalError),
              },
              status,
            );
          }
        },
      });
    }

    middlewares.push({
      name: 'telemetry-runtime-status',
      path: DEFAULT_RUNTIME_STATUS_ENDPOINT,
      method: 'get',
      order: 'pre',
      handler: async (c: Context<ServerEnv>) => {
        try {
          if (runtimeFallbackSignalConfig?.auth.enabled) {
            enforceRuntimeFallbackSignalAuthToken(
              c.req.header(runtimeFallbackSignalConfig.auth.headerName),
              runtimeFallbackSignalConfig.auth,
            );
          }

          return c.json({
            ok: true,
            timestamp: Date.now(),
            telemetry: {
              queueStats: registry.getQueueStats(),
              exporterHealth: registry.getExporterHealth(),
            },
            canary: canaryOrchestrator
              ? {
                  enabled: true,
                  ...canaryOrchestrator.getStatusSnapshot(),
                }
              : {
                  enabled: false,
                },
            runtimeFallbackSignal: runtimeFallbackSignalConfig
              ? {
                  enabled: true,
                  endpoint: runtimeFallbackSignalConfig.endpoint,
                  gateName: runtimeFallbackSignalConfig.gateName,
                  failureHoldMs: runtimeFallbackSignalConfig.failureHoldMs,
                  maxBodyBytes: runtimeFallbackSignalConfig.maxBodyBytes,
                  auth: {
                    enabled: runtimeFallbackSignalConfig.auth.enabled,
                    headerName: runtimeFallbackSignalConfig.auth.headerName,
                  },
                  trustPolicy: {
                    allowedApps:
                      runtimeFallbackSignalConfig.trustPolicy.allowedApps,
                    allowedEntryOrigins:
                      runtimeFallbackSignalConfig.trustPolicy
                        .allowedEntryOrigins,
                    enforceRuntimeDigest:
                      runtimeFallbackSignalConfig.trustPolicy
                        .enforceRuntimeDigest,
                    expectedRuntimeDigestsCount: Object.keys(
                      runtimeFallbackSignalConfig.trustPolicy
                        .expectedRuntimeDigests,
                    ).length,
                    maxSignalsPerWindow:
                      runtimeFallbackSignalConfig.trustPolicy
                        .maxSignalsPerWindow,
                    windowMs: runtimeFallbackSignalConfig.trustPolicy.windowMs,
                    dedupeWindowMs:
                      runtimeFallbackSignalConfig.trustPolicy.dedupeWindowMs,
                  },
                }
              : {
                  enabled: false,
                },
          });
        } catch (error) {
          const signalError = error as RuntimeSignalError;
          return c.json(
            {
              ok: false,
              error:
                signalError instanceof Error
                  ? signalError.message
                  : String(signalError),
            },
            getRuntimeSignalErrorStatusCode(signalError),
          );
        }
      },
    });

    middlewares.push({
      name: 'inject-telemetry',
      handler: async (c: Context<ServerEnv>, next: Next) => {
        const monitors = c.get('monitors');
        if (monitors) {
          const traceContext = parseTraceparent(c.req.header('traceparent'));
          const monitor: CoreMonitor = event => {
            registry.enqueue(
              toTelemetryEnvelope(event, {
                service: serviceName,
                module: moduleName,
                environment: environmentName,
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

    let prepared = false;
    api.onPrepare(async () => {
      if (prepared) {
        return;
      }
      prepared = true;

      if (telemetryConfig.exporters?.otlp?.enabled) {
        maybeWarnLegacyOtlpEndpoint(telemetryConfig.exporters.otlp.endpoint);
        await registry.register(
          createOtlpTelemetryExporter(telemetryConfig.exporters.otlp),
        );
      }

      if (telemetryConfig.exporters?.victoriaMetrics?.enabled) {
        await registry.register(
          createVictoriaMetricsTelemetryExporter(
            telemetryConfig.exporters.victoriaMetrics,
          ),
        );
      }

      await registry.startupHealthCheck({
        failLoud: telemetryConfig.failLoudStartup ?? true,
      });

      if (!canaryOrchestrator) {
        return;
      }

      canaryOrchestrator.start();
      if (gateSnapshotStorePromise) {
        const gateSnapshotStore = await gateSnapshotStorePromise;
        contractGateAutopilot = new ContractGateAutopilot({
          orchestrator: canaryOrchestrator,
          gateSnapshotPath: resolveContractGateSnapshotPath(
            appDirectory,
            canaryConfig?.autopilot?.gateSnapshotPath,
          ),
          gateSnapshotStore,
          pollIntervalMs: canaryConfig?.autopilot?.pollIntervalMs,
          gateStaleAfterMs: canaryConfig?.autopilot?.gateStaleAfterMs,
        });
      }
      if (contractGateAutopilot) {
        await contractGateAutopilot.start();
      }
      canaryOrchestrator.evaluate();
    });
  },
});
