import {
  getSnapshotGateNames,
  normalizeSnapshot,
} from './contract-gate-snapshot-normalization';
import { createFileContractGateSnapshotStore } from './contract-gate-snapshot-store/file-store';
import type {
  ContractGateSnapshotStore,
  GateSnapshot,
} from './contract-gate-snapshot-store/types';
import type { TelemetryHealthMonitor } from './telemetry/healthMonitor';

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_GATE_STALE_AFTER_MS = 10 * 60_000;

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type ContractGateSnapshotObserverOptions = {
  monitor: TelemetryHealthMonitor;
  gateSnapshotPath?: string;
  gateSnapshotStore?: ContractGateSnapshotStore;
  pollIntervalMs?: number;
  gateStaleAfterMs?: number;
  logger?: LoggerLike;
};

/** Polls contract-gate snapshots and exposes them to telemetry health checks. */
export class ContractGateSnapshotObserver {
  private readonly monitor: TelemetryHealthMonitor;
  private readonly gateSnapshotStore: ContractGateSnapshotStore;
  private readonly gateSnapshotPath?: string;
  private readonly pollIntervalMs: number;
  private readonly gateStaleAfterMs: number;
  private readonly logger?: LoggerLike;
  private poller?: ReturnType<typeof setInterval>;
  private syncGeneration = 0;
  private readonly appliedGateFingerprints = new Map<string, string>();

  constructor(options: ContractGateSnapshotObserverOptions) {
    this.monitor = options.monitor;
    if (!options.gateSnapshotStore && !options.gateSnapshotPath) {
      throw new Error(
        'ContractGateSnapshotObserver requires gateSnapshotPath or gateSnapshotStore',
      );
    }
    this.gateSnapshotPath = options.gateSnapshotPath;
    this.gateSnapshotStore =
      options.gateSnapshotStore ||
      createFileContractGateSnapshotStore(options.gateSnapshotPath!);
    this.pollIntervalMs = Math.max(
      250,
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    this.gateStaleAfterMs = Math.max(
      0,
      options.gateStaleAfterMs ?? DEFAULT_GATE_STALE_AFTER_MS,
    );
    this.logger = options.logger;
  }

  async start() {
    await this.syncOnce();

    if (this.poller) {
      return;
    }

    this.poller = setInterval(() => {
      void this.syncOnce();
    }, this.pollIntervalMs);
    if (typeof (this.poller as NodeJS.Timeout).unref === 'function') {
      (this.poller as NodeJS.Timeout).unref();
    }
  }

  stop() {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = undefined;
    }
  }

  async syncOnce() {
    const syncGeneration = ++this.syncGeneration;
    const snapshot = await this.loadSnapshot();
    if (syncGeneration !== this.syncGeneration || !snapshot) {
      return 0;
    }

    const snapshotGateNames = getSnapshotGateNames(snapshot);
    const gates = normalizeSnapshot(snapshot, {
      now: Date.now(),
      gateStaleAfterMs: this.gateStaleAfterMs,
    });
    let updatedCount = snapshotGateNames
      ? this.clearOmittedGates(snapshotGateNames)
      : 0;
    for (const gate of gates) {
      this.monitor.addRequiredContractGate(gate.name);
      const fingerprint = `${gate.passed ? '1' : '0'}:${gate.reason || ''}`;
      if (this.appliedGateFingerprints.get(gate.name) === fingerprint) {
        continue;
      }

      this.monitor.setContractGate(gate.name, gate.passed, gate.reason);
      this.appliedGateFingerprints.set(gate.name, fingerprint);
      updatedCount += 1;
      this.logger?.info?.(
        `[telemetry.health.snapshot] gate=${gate.name} passed=${String(gate.passed)} reason=${gate.reason || 'none'}`,
      );
    }

    return updatedCount;
  }

  private clearOmittedGates(snapshotGateNames: ReadonlySet<string>) {
    let updatedCount = 0;
    for (const gateName of Array.from(this.appliedGateFingerprints.keys())) {
      if (snapshotGateNames.has(gateName)) {
        continue;
      }

      this.monitor.setContractGate(gateName, true);
      this.appliedGateFingerprints.delete(gateName);
      updatedCount += 1;
      this.logger?.info?.(
        `[telemetry.health.snapshot] gate=${gateName} passed=true reason=omitted`,
      );
    }

    return updatedCount;
  }

  private async loadSnapshot(): Promise<GateSnapshot | undefined> {
    try {
      return (await this.gateSnapshotStore.readSnapshot()) || undefined;
    } catch (error) {
      const source =
        this.gateSnapshotPath || this.gateSnapshotStore.name || 'stateStore';
      this.logger?.warn?.(
        `[telemetry.health.snapshot] failed to load gate snapshot ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}
