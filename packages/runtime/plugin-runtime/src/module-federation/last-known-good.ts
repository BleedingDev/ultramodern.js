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
 * to `degraded`. Only a compatible record is promoted to last-known-good;
 * degraded and incompatible provider results remain live responses without
 * replacing the recovery snapshot. The ref's external-major participates in
 * lookup validation but not in the storage key.
 */
import { selectResolvedSurface } from '@modern-js/utils/universal';
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

function resolutionAnswersRef(
  resolved: ResolvedDeliveryUnit,
  ref: ParsedSurfaceRef,
): boolean {
  const selected = selectResolvedSurface(resolved, ref);
  return selected.ok && selected.surface.servedMajor === ref.major;
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
  let nextResolutionGeneration = 0;
  const latestCacheableGenerationByKey = new Map<string, number>();
  const writeTailByKey = new Map<string, Promise<void>>();

  async function cacheCompatibleResolution(
    key: string,
    generation: number,
    record: LkgRecord,
  ): Promise<void> {
    latestCacheableGenerationByKey.set(
      key,
      Math.max(latestCacheableGenerationByKey.get(key) ?? 0, generation),
    );
    // This orders writes made by this wrapper instance. LkgStorage has no
    // revisioned CAS contract, so it intentionally makes no cross-process claim.
    const previous = writeTailByKey.get(key) ?? Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(async () => {
        if (latestCacheableGenerationByKey.get(key) !== generation) {
          return;
        }
        await storage.write(key, record);
      });
    writeTailByKey.set(key, write);
    try {
      await write;
    } finally {
      if (writeTailByKey.get(key) === write) {
        writeTailByKey.delete(key);
      }
    }
  }

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

    // A unit-level cache entry is only usable when it contains the exact
    // requested surface materialization. The storage key intentionally lets
    // sibling surfaces share one atomic snapshot, but it must not turn one
    // cached surface into evidence that every possible surface exists.
    if (!resolutionAnswersRef(cached.resolved, ref)) {
      return fallback();
    }

    // Only a previously compatible record is a last-known-good snapshot.
    // Defend against pluggable stores that contain degraded or incompatible
    // records even though the write path below rejects both.
    if (cached.resolved.compatibility.status !== 'compatible') {
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
      const generation = ++nextResolutionGeneration;

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

      if (!resolutionAnswersRef(resolution.unit, ref)) {
        return serveFromCache(ref, env, () => ({
          ok: false,
          error: createDiscoveryError(
            'identity-mismatch',
            ref,
            `Provider ${options.provider.name} returned a delivery unit that does not answer the requested surface.`,
            {
              env,
              provider: options.provider.name,
              recordUnitId: resolution.unit.unitId,
              availableSurfaces: resolution.unit.surfaces.map(
                surface => surface.surfaceId,
              ),
            },
          ),
        }));
      }

      // Fresh compatible success: swap the whole record atomically. Degraded
      // and incompatible refreshes are still returned live, but neither can
      // replace the prior known-good snapshot used for recovery.
      if (resolution.unit.compatibility.status === 'compatible') {
        await cacheCompatibleResolution(key, generation, {
          resolved: resolution.unit,
          storedAt: now(),
          major: ref.major,
        });
      }
      return resolution;
    },
  };
}
