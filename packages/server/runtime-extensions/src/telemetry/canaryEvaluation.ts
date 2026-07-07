import type {
  TelemetryCanaryContractGateStatus,
  TelemetryCanaryFailure,
} from './canary';

import type { TelemetryQueueStats } from './registryTypes';

export interface TelemetryCanaryHealthMetrics {
  queueStats: TelemetryQueueStats;
  unhealthyExporterCount: number;
  requiredContractGates: readonly string[];
  contractGates: ReadonlyMap<string, TelemetryCanaryContractGateStatus>;
}

export interface TelemetryCanaryHealthThresholds {
  maxQueueUtilization: number;
  maxTotalDropped: number;
  maxUnhealthyExporters: number;
}

export interface TelemetryCanaryHealthEvaluation {
  failures: TelemetryCanaryFailure[];
  queueStats: TelemetryQueueStats;
  unhealthyExporterCount: number;
}

export const evaluateCanaryHealth = (
  metrics: TelemetryCanaryHealthMetrics,
  thresholds: TelemetryCanaryHealthThresholds,
): TelemetryCanaryHealthEvaluation => {
  const failures: TelemetryCanaryFailure[] = [];
  const { queueStats, unhealthyExporterCount } = metrics;

  if (queueStats.utilization > thresholds.maxQueueUtilization) {
    failures.push({
      reason: 'queue_utilization',
      threshold: thresholds.maxQueueUtilization,
      value: queueStats.utilization,
    });
  }

  if (queueStats.totalDropped > thresholds.maxTotalDropped) {
    failures.push({
      reason: 'queue_dropped',
      threshold: thresholds.maxTotalDropped,
      value: queueStats.totalDropped,
    });
  }

  if (unhealthyExporterCount > thresholds.maxUnhealthyExporters) {
    failures.push({
      reason: 'unhealthy_exporter',
      threshold: thresholds.maxUnhealthyExporters,
      value: unhealthyExporterCount,
    });
  }

  for (const gateName of metrics.requiredContractGates) {
    const gate = metrics.contractGates.get(gateName);
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
};
