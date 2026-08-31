import { clamp } from './envelope';
import {
  evaluateTelemetryHealth,
  type TelemetryHealthEvaluationResult,
} from './healthEvaluation';

import type { TelemetryRegistry } from './registry';
import type { TelemetryQueueStats } from './registryTypes';

export type TelemetryHealthState = 'pending' | 'healthy' | 'unhealthy';
export type TelemetryHealthTransition =
  | 'none'
  | 'became_healthy'
  | 'became_unhealthy';
export type TelemetryHealthFailureReason =
  | 'queue_utilization'
  | 'queue_dropped'
  | 'unhealthy_exporter'
  | 'contract_gate_missing'
  | 'contract_gate_failed';

export interface TelemetryHealthFailure {
  reason: TelemetryHealthFailureReason;
  gate?: string;
  message?: string;
  threshold?: number;
  value?: number;
}

export interface TelemetryContractGateStatus {
  name: string;
  passed: boolean;
  reason?: string;
  updatedAt: number;
}

export interface TelemetryHealthEvaluation {
  timestamp: number;
  transition: TelemetryHealthTransition;
  state: TelemetryHealthState;
  consecutiveHealthy: number;
  consecutiveFailures: number;
  failures: TelemetryHealthFailure[];
  queueStats: TelemetryQueueStats;
  unhealthyExporterCount: number;
  contractGates: TelemetryContractGateStatus[];
}

export interface TelemetryHealthStatusSnapshot {
  timestamp: number;
  state: TelemetryHealthState;
  consecutiveHealthy: number;
  consecutiveFailures: number;
  queueStats: TelemetryQueueStats;
  unhealthyExporterCount: number;
  requiredContractGates: string[];
  contractGates: TelemetryContractGateStatus[];
  failurePreview: TelemetryHealthFailure[];
}

export interface TelemetryHealthMonitorOptions {
  registry: TelemetryRegistry;
  evaluationIntervalMs?: number;
  minConsecutiveHealthyEvaluations?: number;
  minConsecutiveFailedEvaluations?: number;
  maxQueueUtilization?: number;
  maxTotalDropped?: number;
  maxUnhealthyExporters?: number;
  requiredContractGates?: string[];
  onEvaluate?: (evaluation: TelemetryHealthEvaluation) => void;
  onTransition?: (evaluation: TelemetryHealthEvaluation) => void;
}

/**
 * Observes telemetry and contract-gate health with hysteresis.
 *
 * This class reports health only. It does not deploy, promote, route, or roll
 * back application revisions.
 */
export class TelemetryHealthMonitor {
  private readonly registry: TelemetryRegistry;
  private readonly evaluationIntervalMs: number;
  private readonly minConsecutiveHealthyEvaluations: number;
  private readonly minConsecutiveFailedEvaluations: number;
  private readonly maxQueueUtilization: number;
  private readonly maxTotalDropped: number;
  private readonly maxUnhealthyExporters: number;
  private requiredContractGates: string[] = [];
  private readonly onEvaluate?: (evaluation: TelemetryHealthEvaluation) => void;
  private readonly onTransition?: (
    evaluation: TelemetryHealthEvaluation,
  ) => void;
  private readonly contractGates = new Map<
    string,
    TelemetryContractGateStatus
  >();
  private state: TelemetryHealthState = 'pending';
  private consecutiveHealthy = 0;
  private consecutiveFailures = 0;
  private evaluationTimer?: ReturnType<typeof setInterval>;

  constructor(options: TelemetryHealthMonitorOptions) {
    this.registry = options.registry;
    this.evaluationIntervalMs = Math.max(
      250,
      options.evaluationIntervalMs ?? 15_000,
    );
    this.minConsecutiveHealthyEvaluations = Math.max(
      1,
      options.minConsecutiveHealthyEvaluations ?? 3,
    );
    this.minConsecutiveFailedEvaluations = Math.max(
      1,
      options.minConsecutiveFailedEvaluations ?? 2,
    );
    this.maxQueueUtilization = clamp(options.maxQueueUtilization ?? 0.8, 0, 1);
    this.maxTotalDropped = Math.max(0, options.maxTotalDropped ?? 0);
    this.maxUnhealthyExporters = Math.max(
      0,
      options.maxUnhealthyExporters ?? 0,
    );
    this.setRequiredContractGates(options.requiredContractGates || []);
    this.onEvaluate = options.onEvaluate;
    this.onTransition = options.onTransition;
  }

  setRequiredContractGates(gates: string[]) {
    this.requiredContractGates = Array.from(
      new Set(gates.map(item => item.trim()).filter(Boolean)),
    );
  }

  addRequiredContractGate(name: string) {
    const normalizedName = name.trim();
    if (
      normalizedName &&
      !this.requiredContractGates.includes(normalizedName)
    ) {
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
      } else {
        this.setContractGate(name, value.passed, value.reason);
      }
    }
  }

  private collectFailures(): TelemetryHealthEvaluationResult {
    const queueStats = this.registry.getQueueStats();
    const unhealthyExporterCount = this.registry
      .getExporterHealth()
      .filter(item => !item.healthy).length;

    return evaluateTelemetryHealth(
      {
        queueStats,
        unhealthyExporterCount,
        requiredContractGates: this.requiredContractGates,
        contractGates: this.contractGates,
      },
      {
        maxQueueUtilization: this.maxQueueUtilization,
        maxTotalDropped: this.maxTotalDropped,
        maxUnhealthyExporters: this.maxUnhealthyExporters,
      },
    );
  }

  evaluate(): TelemetryHealthEvaluation {
    const { failures, queueStats, unhealthyExporterCount } =
      this.collectFailures();
    let transition: TelemetryHealthTransition = 'none';

    if (failures.length > 0) {
      this.consecutiveHealthy = 0;
      this.consecutiveFailures += 1;
      if (
        this.state !== 'unhealthy' &&
        this.consecutiveFailures >= this.minConsecutiveFailedEvaluations
      ) {
        this.state = 'unhealthy';
        transition = 'became_unhealthy';
      }
    } else {
      this.consecutiveFailures = 0;
      this.consecutiveHealthy += 1;
      if (
        this.state !== 'healthy' &&
        this.consecutiveHealthy >= this.minConsecutiveHealthyEvaluations
      ) {
        this.state = 'healthy';
        transition = 'became_healthy';
      }
    }

    const evaluation: TelemetryHealthEvaluation = {
      timestamp: Date.now(),
      transition,
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
      this.onEvaluate?.(evaluation);
    } catch (_error) {
      // Health observers must never crash the server.
    }

    if (transition !== 'none') {
      try {
        this.onTransition?.(evaluation);
      } catch (_error) {
        // Health observers must never crash the server.
      }
    }

    return evaluation;
  }

  getStatusSnapshot(): TelemetryHealthStatusSnapshot {
    const { failures, queueStats, unhealthyExporterCount } =
      this.collectFailures();
    return {
      timestamp: Date.now(),
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
