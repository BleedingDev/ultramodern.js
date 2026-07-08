import type {
  GateSnapshot,
  GateSnapshotGateValue,
} from './contract-gate-snapshot-store/types';

type NormalizedGate = {
  name: string;
  passed: boolean;
  reason?: string;
  updatedAt: number;
  expiresAt?: number;
};

type NormalizeSnapshotOptions = {
  now: number;
  gateStaleAfterMs: number;
};

type SnapshotGateEntry = [string, GateSnapshotGateValue];

const getSnapshotGateEntries = (
  snapshot: GateSnapshot,
): SnapshotGateEntry[] | undefined => {
  const gates = snapshot.gates;
  if (!gates || typeof gates !== 'object') {
    return undefined;
  }

  const entries: SnapshotGateEntry[] = [];
  for (const [name, value] of Object.entries(gates)) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      continue;
    }
    entries.push([normalizedName, value]);
  }

  return entries;
};

export const getSnapshotGateNames = (snapshot: GateSnapshot) => {
  const entries = getSnapshotGateEntries(snapshot);
  if (!entries) {
    return undefined;
  }

  const names = new Set<string>();
  for (const [name] of entries) {
    names.add(name);
  }

  return names;
};

export const normalizeSnapshot = (
  snapshot: GateSnapshot,
  { now, gateStaleAfterMs }: NormalizeSnapshotOptions,
) => {
  const output: NormalizedGate[] = [];
  const entries = getSnapshotGateEntries(snapshot);
  if (!entries) {
    return output;
  }

  for (const [normalizedName, value] of entries) {
    const gate = normalizeGateValue(value, snapshot.updatedAt, now);
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
      gateStaleAfterMs > 0 && now - gate.updatedAt > gateStaleAfterMs;
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
};

const normalizeGateValue = (
  value: GateSnapshotGateValue,
  snapshotUpdatedAt: number | undefined,
  now: number,
) => {
  if (typeof value === 'boolean') {
    return {
      passed: value,
      updatedAt: normalizeUpdatedAt(snapshotUpdatedAt, now),
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
    reason = reason || 'Gate snapshot record missing "passed" boolean';
  }
  return {
    passed,
    reason,
    updatedAt: normalizeUpdatedAt(value.updatedAt ?? snapshotUpdatedAt, now),
    expiresAt: normalizeExpiresAt(value.expiresAt),
  };
};

const normalizeUpdatedAt = (value: number | undefined, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
};

const normalizeExpiresAt = (value: number | undefined) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
};
