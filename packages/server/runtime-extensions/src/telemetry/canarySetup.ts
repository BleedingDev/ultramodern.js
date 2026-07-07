import type { ServerTelemetryUserConfig } from '@modern-js/server-core';
import {
  type ContractGateSnapshotStore,
  DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH,
  resolveContractGateSnapshotPath,
  resolveContractGateSnapshotStore,
} from '../contract-gate-snapshot-store';
import {
  createRuntimeFallbackSignalRuntimeState,
  DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS,
  DEFAULT_RUNTIME_FALLBACK_GATE_NAME,
  DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES,
  normalizeRequiredRuntimeFallbackSignalAuthConfig,
  normalizeRuntimeFallbackSignalAuthConfig,
  normalizeRuntimeFallbackTrustPolicy,
  type RuntimeFallbackSignalAuthConfig,
  type RuntimeFallbackSignalConfig,
  resolveRuntimeFallbackSignalEndpoint,
} from '../runtimeFallbackSignal';
import {
  type TelemetryCanaryDecision,
  TelemetryCanaryOrchestrator,
  TelemetryRegistry,
} from '../telemetryCore';

type SetupTelemetryCanaryOptions = {
  registry: TelemetryRegistry;
  appDirectory: string;
  canaryConfig: ServerTelemetryUserConfig['canary'] | undefined;
};

type SetupTelemetryCanaryResult = {
  canaryOrchestrator?: TelemetryCanaryOrchestrator;
  gateSnapshotStorePromise?: Promise<ContractGateSnapshotStore>;
  runtimeFallbackSignalConfig?: RuntimeFallbackSignalConfig;
  runtimeStatusAuthConfig?: RuntimeFallbackSignalAuthConfig;
};

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

export const setupTelemetryCanary = ({
  registry,
  appDirectory,
  canaryConfig,
}: SetupTelemetryCanaryOptions): SetupTelemetryCanaryResult => {
  if (!canaryConfig?.enabled) {
    return {};
  }

  const contractGates = canaryConfig.contractGates as
    | Record<string, boolean | { passed: boolean; reason?: string }>
    | undefined;

  const canaryOrchestrator = new TelemetryCanaryOrchestrator({
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

  let gateSnapshotStorePromise: Promise<ContractGateSnapshotStore> | undefined;
  let runtimeFallbackSignalConfig: RuntimeFallbackSignalConfig | undefined;

  const autopilotEnabled = canaryConfig.autopilot?.enabled ?? true;
  if (autopilotEnabled) {
    const gateSnapshotPath = resolveContractGateSnapshotPath(
      appDirectory,
      canaryConfig.autopilot?.gateSnapshotPath,
    );
    gateSnapshotStorePromise = resolveContractGateSnapshotStore({
      appDirectory,
      gateSnapshotPath: gateSnapshotPath || DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH,
      stateStore: canaryConfig.autopilot?.stateStore,
    });

    const runtimeSignalConfig = canaryConfig.autopilot?.runtimeFallbackSignal;
    // The signal endpoint can persist failing contract gates and force
    // canary orchestrator into rollback, so it is opt-in (default
    // OFF) and requires a configured auth token when enabled.
    const runtimeSignalEnabled = runtimeSignalConfig?.enabled === true;
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
        auth: normalizeRequiredRuntimeFallbackSignalAuthConfig(
          runtimeSignalConfig?.auth,
        ),
        trustPolicy: normalizeRuntimeFallbackTrustPolicy(
          runtimeSignalConfig?.trustPolicy,
        ),
        runtimeState: createRuntimeFallbackSignalRuntimeState(),
      };
    }
  }

  // The runtime status endpoint exposes detail only to authenticated
  // callers. Auth can be configured through runtimeFallbackSignal.auth
  // even when the signal endpoint itself stays disabled.
  const runtimeStatusAuthConfig =
    runtimeFallbackSignalConfig?.auth ??
    normalizeRuntimeFallbackSignalAuthConfig(
      canaryConfig.autopilot?.runtimeFallbackSignal?.auth,
    );

  return {
    canaryOrchestrator,
    gateSnapshotStorePromise,
    runtimeFallbackSignalConfig,
    runtimeStatusAuthConfig,
  };
};
