import {
  buildDroppedEnvelope,
  buildQueueDepthEnvelope,
  buildQueueUtilizationEnvelope,
  buildStartupProbeEnvelope,
  clamp,
  redactObject,
  type TelemetryEnvelope,
  type TelemetryEnvelopeBuilderContext,
  type TelemetryExporter,
} from './envelope';
import {
  type TelemetryExporterHealthStatus,
  type TelemetryQueueStats,
  type TelemetryRegistryOptions,
  type TelemetrySloAlert,
  type TelemetrySloAlertType,
  TelemetryStartupHealthError,
} from './registryTypes';

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
        this.droppedCount,
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
      ...this.baseEnvelope(),
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
      ...this.baseEnvelope(),
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
      ...this.baseEnvelope(),
      signalType: 'trace',
      name: input.name,
      traceId: input.traceId,
      spanId: input.spanId,
      parentSpanId: input.parentSpanId,
      tags: input.tags,
      attributes: input.attributes,
    });
  }

  private baseEnvelope(): Pick<
    TelemetryEnvelope,
    'timestamp' | 'service' | 'module' | 'environment'
  > {
    return {
      timestamp: Date.now(),
      service: this.service,
      module: this.module,
      environment: this.environment,
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

  async startupHealthCheck(options?: { failLoud?: boolean }) {
    if (this.exporters.length === 0) {
      return;
    }

    const probeBatch = [
      buildStartupProbeEnvelope({
        service: this.service,
        module: this.module,
        environment: this.environment,
        maxQueueSize: this.maxQueueSize,
      }),
    ];
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
    const envelopeContext: TelemetryEnvelopeBuilderContext = {
      service: this.service,
      module: this.module,
      environment: this.environment,
      maxQueueSize: this.maxQueueSize,
    };
    if (queueDepthBeforeFlush > 0) {
      this.queue.unshift(
        buildQueueUtilizationEnvelope(envelopeContext, queueDepthBeforeFlush),
      );
      this.queue.unshift(
        buildQueueDepthEnvelope(envelopeContext, queueDepthBeforeFlush),
      );
    }

    if (this.droppedCount > 0) {
      const droppedCount = this.droppedCount;
      this.droppedCount = 0;
      this.queue.unshift(buildDroppedEnvelope(envelopeContext, droppedCount));
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
