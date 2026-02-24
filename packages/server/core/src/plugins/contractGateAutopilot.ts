import path from 'path';
import { fs } from '@modern-js/utils';
import type { TelemetryCanaryOrchestrator } from './telemetry';

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_GATE_STALE_AFTER_MS = 10 * 60_000;

type GateSnapshotGateValue =
  | boolean
  | {
      passed?: boolean;
      reason?: string;
      updatedAt?: number;
      expiresAt?: number;
    };

type GateSnapshot = {
  schemaVersion?: number;
  updatedAt?: number;
  gates?: Record<string, GateSnapshotGateValue>;
};

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type ContractGateAutopilotOptions = {
  orchestrator: TelemetryCanaryOrchestrator;
  gateSnapshotPath: string;
  pollIntervalMs?: number;
  gateStaleAfterMs?: number;
  logger?: LoggerLike;
};

type NormalizedGate = {
  name: string;
  passed: boolean;
  reason?: string;
  updatedAt: number;
  expiresAt?: number;
};

export class ContractGateAutopilot {
  private readonly orchestrator: TelemetryCanaryOrchestrator;
  private readonly gateSnapshotPath: string;
  private readonly pollIntervalMs: number;
  private readonly gateStaleAfterMs: number;
  private readonly logger?: LoggerLike;
  private poller?: ReturnType<typeof setInterval>;
  private lastSnapshotMtimeMs = -1;
  private readonly appliedGateFingerprints = new Map<string, string>();

  constructor(options: ContractGateAutopilotOptions) {
    this.orchestrator = options.orchestrator;
    this.gateSnapshotPath = path.resolve(options.gateSnapshotPath);
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
    const snapshot = await this.loadSnapshot();
    if (!snapshot) {
      return 0;
    }

    const gates = this.normalizeSnapshot(snapshot);
    let updatedCount = 0;
    for (const gate of gates) {
      this.orchestrator.addRequiredContractGate(gate.name);
      const fingerprint = `${gate.passed ? '1' : '0'}:${gate.reason || ''}`;
      if (this.appliedGateFingerprints.get(gate.name) === fingerprint) {
        continue;
      }

      this.orchestrator.setContractGate(gate.name, gate.passed, gate.reason);
      this.appliedGateFingerprints.set(gate.name, fingerprint);
      updatedCount += 1;
      this.logger?.info?.(
        `[telemetry.canary.autopilot] gate=${gate.name} passed=${String(gate.passed)} reason=${gate.reason || 'none'}`,
      );
    }

    return updatedCount;
  }

  private async loadSnapshot() {
    try {
      if (!(await fs.pathExists(this.gateSnapshotPath))) {
        return undefined;
      }

      const stat = await fs.stat(this.gateSnapshotPath);
      if (stat.mtimeMs <= this.lastSnapshotMtimeMs) {
        return undefined;
      }
      this.lastSnapshotMtimeMs = stat.mtimeMs;

      const raw = await fs.readFile(this.gateSnapshotPath, 'utf8');
      const parsed = JSON.parse(raw) as GateSnapshot;
      if (!parsed || typeof parsed !== 'object') {
        this.logger?.warn?.(
          `[telemetry.canary.autopilot] invalid gate snapshot at ${this.gateSnapshotPath}`,
        );
        return undefined;
      }

      return parsed;
    } catch (error) {
      this.logger?.warn?.(
        `[telemetry.canary.autopilot] failed to load gate snapshot ${this.gateSnapshotPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private normalizeSnapshot(snapshot: GateSnapshot) {
    const now = Date.now();
    const output: NormalizedGate[] = [];
    const gates = snapshot.gates;
    if (!gates || typeof gates !== 'object') {
      return output;
    }

    for (const [name, value] of Object.entries(gates)) {
      const normalizedName = name.trim();
      if (!normalizedName) {
        continue;
      }

      const gate = this.normalizeGateValue(value, snapshot.updatedAt, now);
      if (!gate) {
        continue;
      }

      if (
        typeof gate.expiresAt === 'number' &&
        Number.isFinite(gate.expiresAt) &&
        gate.expiresAt > 0 &&
        now >= gate.expiresAt
      ) {
        output.push({
          name: normalizedName,
          passed: true,
          reason: undefined,
          updatedAt: gate.updatedAt,
          expiresAt: gate.expiresAt,
        });
        continue;
      }

      const isStale =
        this.gateStaleAfterMs > 0 &&
        now - gate.updatedAt > this.gateStaleAfterMs;
      if (isStale) {
        output.push({
          name: normalizedName,
          passed: false,
          reason: gate.reason || 'Gate snapshot is stale',
          updatedAt: gate.updatedAt,
        });
        continue;
      }

      output.push({
        name: normalizedName,
        passed: gate.passed,
        reason: gate.reason,
        updatedAt: gate.updatedAt,
      });
    }

    return output;
  }

  private normalizeGateValue(
    value: GateSnapshotGateValue,
    snapshotUpdatedAt: number | undefined,
    now: number,
  ) {
    if (typeof value === 'boolean') {
      return {
        passed: value,
        updatedAt: this.normalizeUpdatedAt(snapshotUpdatedAt, now),
      };
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const hasPassed = typeof value.passed === 'boolean';
    const passed = value.passed === true;
    let reason =
      typeof value.reason === 'string' && value.reason.trim().length > 0
        ? value.reason
        : undefined;
    if (!hasPassed) {
      reason = reason || 'Gate snapshot record is missing "passed" boolean';
    }
    return {
      passed,
      reason,
      updatedAt: this.normalizeUpdatedAt(
        value.updatedAt ?? snapshotUpdatedAt,
        now,
      ),
      expiresAt: this.normalizeExpiresAt(value.expiresAt),
    };
  }

  private normalizeUpdatedAt(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    return fallback;
  }

  private normalizeExpiresAt(value: number | undefined) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    return undefined;
  }
}
