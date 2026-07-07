import {
  evaluateCanaryHealth,
  type TelemetryCanaryHealthEvaluation,
} from './canaryEvaluation';
import { clamp } from './envelope';

import type { TelemetryRegistry } from './registry';

import type { TelemetryQueueStats } from './registryTypes';

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

  private collectFailures(): TelemetryCanaryHealthEvaluation {
    const queueStats = this.registry.getQueueStats();
    const unhealthyExporterCount = this.registry
      .getExporterHealth()
      .filter(item => !item.healthy).length;

    return evaluateCanaryHealth(
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
