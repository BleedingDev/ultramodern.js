// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
/**
 * G24a/b — last-known-good (LKG) provider wrapper.
 *
 * RESOLUTION-0001 §2.2: the LKG cache "wraps any provider; serves the last
 * complete record on provider failure, marked `compatibility: 'degraded'`". It
 * is universal — no DOM/fetch/framework coupling — so the same wrapper works in
 * the browser, Node, and Cloudflare.
 *
 * Rollback semantics (ADR-0019 / CONTEXT.md Rollback): the record is the unit
 * of rollback. The cache stores exactly ONE whole {@link ResolvedDeliveryUnit}
 * per (ref, env) key and swaps it atomically on each fresh success. It never
 * stores or serves a partial record, and it never mixes locations across build
 * markers — a served degraded record is a byte-for-byte prior success with only
 * its {@link CompatibilityVerdict} flipped to `degraded`.
 */
import {
  type DiscoveryError,
  type EnvironmentId,
  isDiscoveryError,
  type ResolvedDeliveryUnit,
  type SurfaceProvider,
  type SurfaceRef,
  type SurfaceResolution,
  surfaceResolutionKey,
} from './surface-resolution-types';

/** One cached complete record plus the time it was stored. */
export type LkgRecord = {
  resolved: ResolvedDeliveryUnit;
  storedAt: number;
};

/**
 * Pluggable storage hook. The default is an in-memory Map; callers may supply a
 * durable store (KV, disk, etc). Reads/writes may be async. A store only ever
 * receives whole records.
 */
export type LkgStorage = {
  read(key: string): (LkgRecord | undefined) | Promise<LkgRecord | undefined>;
  write(key: string, record: LkgRecord): void | Promise<void>;
};

export type LkgFreshnessPolicy = {
  /**
   * Maximum age, in ms, a stored record may be served after a provider
   * failure. When omitted, a served record never expires by age. A record
   * older than this yields a typed `stale-record` {@link DiscoveryError}.
   */
  maxStaleMs?: number;
};

export type LastKnownGoodOptions = {
  /** The wrapped provider (env/static, Zephyr, or any other). */
  provider: SurfaceProvider;
  /** Pluggable storage; defaults to a process-local in-memory Map. */
  storage?: LkgStorage;
  freshness?: LkgFreshnessPolicy;
  /** Clock injection for deterministic freshness tests. */
  now?: () => number;
};

/** Default process-local in-memory storage. */
export function createInMemoryLkgStorage(): LkgStorage {
  const map = new Map<string, LkgRecord>();
  return {
    read(key) {
      return map.get(key);
    },
    write(key, record) {
      map.set(key, record);
    },
  };
}

/** Flip a resolved record's verdict to degraded without mutating the input. */
function markDegraded(
  resolved: ResolvedDeliveryUnit,
  reason: string,
): ResolvedDeliveryUnit {
  return {
    ...resolved,
    compatibility: {
      ...resolved.compatibility,
      status: 'degraded',
      reason,
    },
  };
}

function staleRecordError(
  ref: SurfaceRef,
  env: EnvironmentId,
  ageMs: number,
  maxStaleMs: number,
): DiscoveryError {
  return {
    kind: 'discovery-error',
    code: 'stale-record',
    message: `Last-known-good record for surface is stale: age ${ageMs}ms exceeds maxStaleMs ${maxStaleMs}ms`,
    ref,
    env,
  };
}

/**
 * Wrap a provider with a last-known-good cache. On success the whole record is
 * cached (atomic swap). On provider failure (typed {@link DiscoveryError} or a
 * thrown error) the last complete record is served, marked degraded — unless it
 * has expired per {@link LkgFreshnessPolicy}, in which case a typed
 * `stale-record` error is returned. If there is no cached record, the original
 * failure is passed through (a thrown error becomes a `provider-unavailable`
 * {@link DiscoveryError}).
 */
export function createLastKnownGoodProvider(
  options: LastKnownGoodOptions,
): SurfaceProvider {
  const storage = options.storage ?? createInMemoryLkgStorage();
  const now = options.now ?? (() => Date.now());
  const maxStaleMs = options.freshness?.maxStaleMs;

  async function serveFromCache(
    ref: SurfaceRef,
    env: EnvironmentId,
    fallback: () => SurfaceResolution,
  ): Promise<SurfaceResolution> {
    const key = surfaceResolutionKey(ref, env);
    const cached = await storage.read(key);
    if (!cached) {
      return fallback();
    }

    const ageMs = now() - cached.storedAt;
    if (maxStaleMs !== undefined && ageMs > maxStaleMs) {
      return staleRecordError(ref, env, ageMs, maxStaleMs);
    }

    return markDegraded(
      cached.resolved,
      `served last-known-good record (age ${ageMs}ms) after provider failure`,
    );
  }

  return {
    async resolve(
      ref: SurfaceRef,
      env: EnvironmentId,
    ): Promise<SurfaceResolution> {
      const key = surfaceResolutionKey(ref, env);

      let resolution: SurfaceResolution;
      try {
        resolution = await options.provider.resolve(ref, env);
      } catch (error) {
        return serveFromCache(ref, env, () => ({
          kind: 'discovery-error',
          code: 'provider-unavailable',
          message:
            error instanceof Error
              ? error.message
              : 'provider threw a non-error value',
          ref,
          env,
        }));
      }

      if (isDiscoveryError(resolution)) {
        // Preserve the resolver's own typed failure when no LKG record exists.
        const failure = resolution;
        return serveFromCache(ref, env, () => failure);
      }

      // Fresh complete success: swap the whole record atomically.
      await storage.write(key, { resolved: resolution, storedAt: now() });
      return resolution;
    },
  };
}
