import type { RuntimeFallbackSignalRuntimeState } from './types';

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
  const dedupeExpiryMs = Math.max(
    trustPolicy.dedupeWindowMs,
    trustPolicy.windowMs,
    1_000,
  );
  runtimeState.dedupeByFingerprint.forEach((lastSeenAt, fingerprint) => {
    if (now - lastSeenAt > dedupeExpiryMs) {
      runtimeState.dedupeByFingerprint.delete(fingerprint);
    }
  });

  runtimeState.rateLimitBySource.forEach((state, source) => {
    if (now - state.windowStartedAt > trustPolicy.windowMs * 2) {
      runtimeState.rateLimitBySource.delete(source);
    }
  });
}
