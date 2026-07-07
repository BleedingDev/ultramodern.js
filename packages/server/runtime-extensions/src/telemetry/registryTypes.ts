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
