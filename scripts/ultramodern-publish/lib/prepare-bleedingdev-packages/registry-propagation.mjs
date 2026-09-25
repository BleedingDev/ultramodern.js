// Consumers: the cohort post-publish verifier (registry.mjs
// verifyRegistryPackage) and the sidecar post-publish wait
// (publish-sidecars.mjs awaitPublishedSidecar). Both lanes run after an
// unrollbackable publish and must outlast the same npm propagation lag.
import { sleep } from './commands.mjs';

// Delays spent between registry reads, front-loaded so a version that is
// already coherent is accepted in seconds, then backing off to 20s reads.
// The total must outlast npm's propagation of a freshly published version:
// run 34689880072 (cohort) saw a packument stay without its version for more
// than 360s, and run 36137116871 (sidecars) failed a publish that became
// readable a few minutes after the 90s sidecar-only window gave up. This
// schedule waits 855s over 60 reads.
const registryPropagationDelaysMs = Object.freeze([
  2000,
  3000,
  5000,
  5000,
  ...Array.from({ length: 24 }, () => 10000),
  ...Array.from({ length: 8 }, () => 15000),
  ...Array.from({ length: 24 }, () => 20000),
]);

/**
 * Poll the registry until `probe` reports a settled state.
 *
 * `probe(attempt)` returns `{ settled: true, value }` once the registry read is
 * decisive, or `{ settled: false, detail }` while it is still propagating. A
 * throw from `probe` is terminal and propagates immediately: only the probe
 * knows which registry states can resolve on their own, so this loop never
 * retries anything the probe did not explicitly report as pending.
 *
 * Resolves to `{ settled: true, value, attempts }`, or to
 * `{ settled: false, detail, attempts }` once every delay has been spent; the
 * caller owns the failure message.
 */
async function pollRegistryPropagation(
  probe,
  { delaysMs = registryPropagationDelaysMs, wait = sleep } = {},
) {
  const attempts = delaysMs.length + 1;
  let detail;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const outcome = await probe(attempt);
    if (outcome.settled) {
      return { attempts: attempt, settled: true, value: outcome.value };
    }
    detail = outcome.detail;
    if (attempt < attempts) {
      await wait(delaysMs[attempt - 1]);
    }
  }
  return { attempts, detail, settled: false };
}

export { pollRegistryPropagation, registryPropagationDelaysMs };
