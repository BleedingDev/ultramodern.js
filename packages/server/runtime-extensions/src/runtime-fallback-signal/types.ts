import type {
  ContractGateSnapshotStore,
  GateSnapshot,
} from '../contract-gate-snapshot-store';

export type RuntimeSignalErrorCode =
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'UNTRUSTED_SOURCE';

export type RuntimeSignalError = Error & {
  code?: RuntimeSignalErrorCode;
};

export type RuntimeFallbackSignalTrustPolicy = {
  allowedApps: string[];
  allowedEntryOrigins: string[];
  expectedRuntimeDigests: Record<string, string>;
  enforceRuntimeDigest: boolean;
  maxSignalsPerWindow: number;
  windowMs: number;
  dedupeWindowMs: number;
};

type RuntimeFallbackSignalRateLimitState = {
  count: number;
  windowStartedAt: number;
};

export type RuntimeFallbackSignalAuthConfig = {
  enabled: boolean;
  headerName: string;
  expectedValue?: string;
};

export type RuntimeFallbackSignalRuntimeState = {
  rateLimitBySource: Map<string, RuntimeFallbackSignalRateLimitState>;
  dedupeByFingerprint: Map<string, number>;
};

export type RuntimeFallbackSignalTrustContext = {
  trustPolicy: RuntimeFallbackSignalTrustPolicy;
  runtimeState: RuntimeFallbackSignalRuntimeState;
};

export type RuntimeFallbackSignalConfig = {
  endpoint: string;
  gateName: string;
  gateSnapshotStore: Promise<ContractGateSnapshotStore>;
  failureHoldMs: number;
  maxBodyBytes: number;
  auth: RuntimeFallbackSignalAuthConfig;
  trustPolicy: RuntimeFallbackSignalTrustPolicy;
  runtimeState: RuntimeFallbackSignalRuntimeState;
};

export type RuntimeFallbackSignalSource = {
  /**
   * Server-trusted connection identity (socket remote address). Never derive
   * this from request headers or the payload: both are attacker-controlled
   * and would let callers reset their own rate-limit budget.
   */
  remoteAddress?: string;
};
