// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
/**
 * G24a/b — last-known-good (LKG) provider wrapper.
 *
 * RESOLUTION-0001 §2.2: the LKG cache "wraps any provider; serves the last
 * complete record on provider failure, marked `compatibility: 'degraded'`". It
 * is universal — no DOM/fetch/framework coupling — so the same wrapper works in
 * the browser, Node, and Cloudflare.
 *
 * Rollback semantics (ADR-0019 / CONTEXT.md Rollback): the delivery UNIT is
 * the unit of rollback. The cache stores exactly ONE whole
 * {@link ResolvedDeliveryUnit} per (unitId, env) key — never per (ref, env) —
 * so every surface of a unit shares one snapshot and a fresh success swaps that
 * snapshot atomically for all of them (two surfaces can never be served from
 * different cached build markers). It never stores or serves a partial record,
 * and it never mixes locations across build markers — a served degraded record
 * is a byte-for-byte prior success with only its compatibility verdict flipped
 * to `degraded`. An `incompatible` record is never good: it is neither cached
 * as the last-known-good snapshot nor ever served. The ref's external-major
 * participates in lookup validation but not in the storage key.
 */
import {
  createDiscoveryError,
  type DiscoveryResult,
  deliveryUnitResolutionKey,
  type EnvironmentId,
  type ParsedSurfaceRef,
  type ResolvedDeliveryUnit,
  type SurfaceResolutionProvider,
} from './surface-resolution-types';

export const LAST_KNOWN_GOOD_PROVIDER_NAME = 'last-known-good';

/** One cached complete record plus the time it was stored. */
export type LkgRecord = {
  resolved: ResolvedDeliveryUnit;
  storedAt: number;
  /**
   * External-major selector the record was resolved against. Participates in
   * lookup validation — a cached record is only served for a matching major —
   * but never in the storage key, which is (unitId, env) so all surfaces of a
   * unit share one atomically-swapped record.
   */
  major?: number;
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
   * older than this yields a typed `stale-record` discovery error.
   */
  maxStaleMs?: number;
};

export type LastKnownGoodOptions = {
  /** The wrapped provider (env/static, Zephyr, or any other). */
  provider: SurfaceResolutionProvider;
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

function staleRecordResult(
  ref: ParsedSurfaceRef,
  env: EnvironmentId,
  ageMs: number,
  maxStaleMs: number,
): DiscoveryResult {
  return {
    ok: false,
    error: createDiscoveryError(
      'stale-record',
      ref,
      `Last-known-good record for surface is stale: age ${ageMs}ms exceeds maxStaleMs ${maxStaleMs}ms`,
      { env, ageMs, maxStaleMs },
    ),
  };
}

/**
 * Wrap a provider with a last-known-good cache. On success the whole record is
 * cached (atomic swap). On provider failure (typed discovery error or a thrown
 * error) the last complete record is served, marked degraded — unless it has
 * expired per {@link LkgFreshnessPolicy}, in which case a typed `stale-record`
 * error is returned. If there is no cached record, the original failure is
 * passed through (a thrown error becomes a `provider-unavailable` discovery
 * error).
 */
export function createLastKnownGoodProvider(
  options: LastKnownGoodOptions,
): SurfaceResolutionProvider {
  const storage = options.storage ?? createInMemoryLkgStorage();
  const now =
    options.now ??
    (() => Math.floor(performance.timeOrigin + performance.now()));
  const maxStaleMs = options.freshness?.maxStaleMs;

  async function serveFromCache(
    ref: ParsedSurfaceRef,
    env: EnvironmentId,
    fallback: () => DiscoveryResult,
  ): Promise<DiscoveryResult> {
    const key = deliveryUnitResolutionKey(ref.unitId, env);
    const cached = await storage.read(key);
    if (!cached) {
      return fallback();
    }

    // The external-major participates in lookup validation: a record resolved
    // against a different major is not a valid last-known-good for this ref.
    if (cached.major !== ref.major) {
      return fallback();
    }

    // Never serve an incompatible record as last-known-good. Only a previously
    // compatible record is served, flipped to degraded (defensive: the write
    // path already refuses to cache incompatible records, but a pluggable
    // store could hold one).
    if (cached.resolved.compatibility.status === 'incompatible') {
      return fallback();
    }

    const ageMs = now() - cached.storedAt;
    if (maxStaleMs !== undefined && ageMs > maxStaleMs) {
      return staleRecordResult(ref, env, ageMs, maxStaleMs);
    }

    return {
      ok: true,
      unit: markDegraded(
        cached.resolved,
        `served last-known-good record (age ${ageMs}ms) after provider failure`,
      ),
    };
  }

  return {
    name: LAST_KNOWN_GOOD_PROVIDER_NAME,
    async resolve(
      ref: ParsedSurfaceRef,
      env: EnvironmentId,
    ): Promise<DiscoveryResult> {
      const key = deliveryUnitResolutionKey(ref.unitId, env);

      let resolution: DiscoveryResult;
      try {
        resolution = await options.provider.resolve(ref, env);
      } catch (error) {
        return serveFromCache(ref, env, () => ({
          ok: false,
          error: createDiscoveryError(
            'provider-unavailable',
            ref,
            error instanceof Error
              ? error.message
              : 'provider threw a non-error value',
            { env, provider: options.provider.name },
          ),
        }));
      }

      if (!resolution.ok) {
        // Preserve the resolver's own typed failure when no LKG record exists.
        const failure = resolution;
        return serveFromCache(ref, env, () => failure);
      }

      // Fresh complete success: swap the whole record atomically — but never
      // cache an incompatible verdict. LKG must retain the last *good* record,
      // so an incompatible refresh is returned live yet leaves the prior good
      // snapshot in place.
      if (resolution.unit.compatibility.status !== 'incompatible') {
        await storage.write(key, {
          resolved: resolution.unit,
          storedAt: now(),
          major: ref.major,
        });
      }
      return resolution;
    },
  };
}
