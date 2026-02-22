export {
  TelemetryRegistry,
  TelemetryCanaryOrchestrator,
  TelemetryStartupHealthError,
  createOtlpTelemetryExporter,
  createVictoriaMetricsTelemetryExporter,
  createTelemetryAwareMetrics,
  hasEnabledTelemetryExporters,
} from '@modern-js/server-core';

export type {
  TelemetryCanaryDecision,
  TelemetrySloAlert,
  TelemetryQueueStats,
} from '@modern-js/server-core';
