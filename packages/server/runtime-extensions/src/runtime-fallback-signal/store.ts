import type { GateSnapshot } from '../contract-gate-snapshot-store';
import { CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION } from '../contract-gate-snapshot-store';
import type {
  RuntimeFallbackSignalConfig,
  RuntimeFallbackSignalRuntimeState,
  RuntimeFallbackSignalTrustPolicy,
} from './model';

export function createRuntimeFallbackSignalRuntimeState(): RuntimeFallbackSignalRuntimeState {
  return {
    rateLimitBySource: new Map(),
    dedupeByFingerprint: new Map(),
  };
}

export function cleanupRuntimeFallbackSignalRuntimeState(
  now: number,
  runtimeState: RuntimeFallbackSignalRuntimeState,
  trustPolicy: RuntimeFallbackSignalTrustPolicy,
) {
  const rateLimitWindowMs = Math.max(1, trustPolicy.windowMs);
  for (const [sourceKey, rateState] of runtimeState.rateLimitBySource) {
    if (now - rateState.windowStartedAt > rateLimitWindowMs) {
      runtimeState.rateLimitBySource.delete(sourceKey);
    }
  }

  const dedupeWindowMs = Math.max(0, trustPolicy.dedupeWindowMs);
  if (dedupeWindowMs === 0) {
    runtimeState.dedupeByFingerprint.clear();
    return;
  }

  for (const [fingerprint, lastSeenAt] of runtimeState.dedupeByFingerprint) {
    if (now - lastSeenAt > dedupeWindowMs) {
      runtimeState.dedupeByFingerprint.delete(fingerprint);
    }
  }
}

export async function persistRuntimeFallbackContractGate(
  payload: Record<string, unknown>,
  runtimeSignalConfig: RuntimeFallbackSignalConfig,
) {
  const now = Date.now();
  const gateSnapshotStore = await runtimeSignalConfig.gateSnapshotStore;
  const snapshot: GateSnapshot = (await gateSnapshotStore.readSnapshot()) || {};
  const existingGates =
    snapshot.gates && typeof snapshot.gates === 'object' ? snapshot.gates : {};

  const reason =
    typeof payload.reason === 'string' ? payload.reason : 'runtime_fallback';
  const phase = typeof payload.phase === 'string' ? payload.phase : 'unknown';
  const appName =
    typeof payload.appName === 'string' ? payload.appName : 'unknown';
  const entry = typeof payload.entry === 'string' ? payload.entry : undefined;

  snapshot.schemaVersion =
    typeof snapshot.schemaVersion === 'number'
      ? snapshot.schemaVersion
      : CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION;
  snapshot.updatedAt = now;
  snapshot.gates = {
    ...existingGates,
    [runtimeSignalConfig.gateName]: {
      passed: false,
      reason: `runtime_fallback:${reason} phase=${phase} app=${appName}${
        entry ? ` entry=${entry}` : ''
      }`,
      updatedAt: now,
      expiresAt: now + runtimeSignalConfig.failureHoldMs,
      source: 'runtime-mf-fallback-signal',
      metadata: payload,
    },
  };

  await gateSnapshotStore.writeSnapshot(snapshot);
}
