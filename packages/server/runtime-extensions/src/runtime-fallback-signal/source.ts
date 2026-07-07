export function normalizeRuntimeSignalOrigin(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch (_error) {
    return undefined;
  }
}

export function normalizeRuntimeSignalAppName(
  payload: Record<string, unknown>,
) {
  if (typeof payload.appName !== 'string') {
    return 'unknown';
  }
  const normalized = payload.appName.trim();
  return normalized.length > 0 ? normalized : 'unknown';
}

export function normalizeRuntimeSignalRuntimeDigest(
  payload: Record<string, unknown>,
) {
  if (
    typeof payload.runtimeDigest === 'string' &&
    payload.runtimeDigest.trim()
  ) {
    return payload.runtimeDigest.trim();
  }

  const metadata = payload.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).runtimeDigest === 'string'
  ) {
    const digest = String(
      (metadata as Record<string, unknown>).runtimeDigest,
    ).trim();
    if (digest) {
      return digest;
    }
  }

  return undefined;
}
