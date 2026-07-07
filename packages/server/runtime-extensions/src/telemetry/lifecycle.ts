import type { ServerTelemetryUserConfig } from '@modern-js/server-core';
import {
  type ContractGateSnapshotStore,
  resolveContractGateSnapshotPath,
} from '../contract-gate-snapshot-store';
import { ContractGateAutopilot } from '../contractGateAutopilot';
import {
  createOtlpTelemetryExporter,
  createVictoriaMetricsTelemetryExporter,
  maybeWarnLegacyOtlpEndpoint,
  TelemetryCanaryOrchestrator,
  TelemetryRegistry,
} from '../telemetryCore';

type TelemetryLifecycleApi = {
  getServerContext: () => unknown;
  onPrepare: (prepare: () => Promise<void>) => void;
};

type RegisterTelemetryLifecycleOptions = {
  api: TelemetryLifecycleApi;
  registry: TelemetryRegistry;
  telemetryConfig: ServerTelemetryUserConfig;
  canaryConfig: ServerTelemetryUserConfig['canary'] | undefined;
  canaryOrchestrator?: TelemetryCanaryOrchestrator;
  gateSnapshotStorePromise?: Promise<ContractGateSnapshotStore>;
  appDirectory: string;
};

/**
 * Active telemetry lane disposers, flushed by a single shared process
 * `beforeExit` hook (a per-lane listener would accumulate listeners across
 * dev-server restarts and embedded multi-server setups).
 */
const activeTelemetryLaneClosers = new Set<() => Promise<void>>();
let telemetryBeforeExitHookInstalled = false;
const ensureTelemetryBeforeExitHook = () => {
  if (telemetryBeforeExitHookInstalled) {
    return;
  }
  telemetryBeforeExitHookInstalled = true;
  process.on('beforeExit', () => {
    for (const close of [...activeTelemetryLaneClosers]) {
      void close();
    }
  });
};

export const registerTelemetryLifecycle = ({
  api,
  registry,
  telemetryConfig,
  canaryConfig,
  canaryOrchestrator,
  gateSnapshotStorePromise,
  appDirectory,
}: RegisterTelemetryLifecycleOptions) => {
  let contractGateAutopilot: ContractGateAutopilot | undefined;
  let telemetryLaneClosed = false;
  const closeTelemetryLane = async () => {
    if (telemetryLaneClosed) {
      return;
    }
    telemetryLaneClosed = true;
    activeTelemetryLaneClosers.delete(closeTelemetryLane);
    contractGateAutopilot?.stop();
    canaryOrchestrator?.stop();
    await registry.shutdown();
  };

  let prepared = false;
  api.onPrepare(async () => {
    if (prepared) {
      return;
    }
    prepared = true;

    // Shutdown path for the telemetry lane: flush pending envelopes and
    // stop canary/autopilot pollers when the node server closes (this also
    // covers dev-server restarts, which close the previous node server
    // before assembling a new one), with process beforeExit as the
    // final-flush floor when no node server handle exists.
    const { nodeServer } = api.getServerContext() as {
      nodeServer?: {
        once?: (event: string, listener: () => void) => unknown;
      };
    };
    if (nodeServer && typeof nodeServer.once === 'function') {
      nodeServer.once('close', () => {
        void closeTelemetryLane();
      });
    }
    activeTelemetryLaneClosers.add(closeTelemetryLane);
    ensureTelemetryBeforeExitHook();

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
};
