import type { ServerTelemetryUserConfig } from '@modern-js/server-core';
import {
  type ContractGateSnapshotStore,
  resolveContractGateSnapshotPath,
} from '../contract-gate-snapshot-store';
import { ContractGateSnapshotObserver } from '../contractGateSnapshotObserver';
import {
  createOtlpTelemetryExporter,
  createVictoriaMetricsTelemetryExporter,
  maybeWarnLegacyOtlpEndpoint,
  TelemetryHealthMonitor,
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
  legacyHealthConfig: ServerTelemetryUserConfig['canary'] | undefined;
  healthMonitor?: TelemetryHealthMonitor;
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
  legacyHealthConfig,
  healthMonitor,
  gateSnapshotStorePromise,
  appDirectory,
}: RegisterTelemetryLifecycleOptions) => {
  let contractGateSnapshotObserver: ContractGateSnapshotObserver | undefined;
  let telemetryLaneClosed = false;
  const closeTelemetryLane = async () => {
    if (telemetryLaneClosed) {
      return;
    }
    telemetryLaneClosed = true;
    activeTelemetryLaneClosers.delete(closeTelemetryLane);
    contractGateSnapshotObserver?.stop();
    healthMonitor?.stop();
    await registry.shutdown();
  };

  let prepared = false;
  api.onPrepare(async () => {
    if (prepared) {
      return;
    }
    prepared = true;

    // Shutdown path for the telemetry lane: flush pending envelopes and
    // stop health/snapshot pollers when the node server closes (this also
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

    if (!healthMonitor) {
      return;
    }

    healthMonitor.start();
    if (gateSnapshotStorePromise) {
      const gateSnapshotStore = await gateSnapshotStorePromise;
      contractGateSnapshotObserver = new ContractGateSnapshotObserver({
        monitor: healthMonitor,
        gateSnapshotPath: resolveContractGateSnapshotPath(
          appDirectory,
          legacyHealthConfig?.autopilot?.gateSnapshotPath,
        ),
        gateSnapshotStore,
        pollIntervalMs: legacyHealthConfig?.autopilot?.pollIntervalMs,
        gateStaleAfterMs: legacyHealthConfig?.autopilot?.gateStaleAfterMs,
      });
    }
    if (contractGateSnapshotObserver) {
      await contractGateSnapshotObserver.start();
    }
    healthMonitor.evaluate();
  });
};
