import { canonicalJson, sha256 } from './release-age-audit.mjs';

// The published lanes rebuild nothing. They resolve the published cohort the
// way a consumer would and prove the result is the closure the source lane
// already built, ran and accepted. Any difference means the registry now
// resolves something that was never accepted, so it fails and names every
// package that moved.

function compareCodeUnits(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function versionsByName(closureIdentities) {
  const byName = new Map();
  for (const { name, version, integrity } of closureIdentities) {
    const versions = byName.get(name) ?? new Map();
    versions.set(version, integrity);
    byName.set(name, versions);
  }
  return byName;
}

function versionList(versions) {
  return [...versions.keys()].sort(compareCodeUnits).join(', ');
}

function resolutionDrift(accepted, observed) {
  const acceptedByName = versionsByName(accepted);
  const observedByName = versionsByName(observed);
  const names = [
    ...new Set([...acceptedByName.keys(), ...observedByName.keys()]),
  ].sort(compareCodeUnits);
  const drift = [];
  for (const name of names) {
    const acceptedVersions = acceptedByName.get(name);
    const observedVersions = observedByName.get(name);
    if (!acceptedVersions) {
      drift.push(
        `${name}: not in the accepted closure, now resolves ${versionList(observedVersions)}`,
      );
    } else if (!observedVersions) {
      drift.push(
        `${name}: accepted ${versionList(acceptedVersions)}, no longer resolved`,
      );
    } else if (
      versionList(acceptedVersions) !== versionList(observedVersions)
    ) {
      drift.push(
        `${name}: accepted ${versionList(acceptedVersions)}, now resolves ${versionList(observedVersions)}`,
      );
    } else {
      for (const [version, integrity] of acceptedVersions) {
        if (observedVersions.get(version) !== integrity) {
          drift.push(
            `${name}@${version}: accepted integrity ${integrity}, now ${observedVersions.get(version)}`,
          );
        }
      }
    }
  }
  return drift;
}

function assertResolutionDigest(resolution, label) {
  if (
    !Array.isArray(resolution?.closureIdentities) ||
    resolution.closureIdentities.length === 0 ||
    resolution.closureSha256 !==
      sha256(canonicalJson(resolution.closureIdentities))
  ) {
    throw new Error(
      `${label} closure identities do not match its closureSha256; the evidence was altered or produced by an older schema.`,
    );
  }
}

// `accepted` and `observed` are { closureIdentities, closureSha256 } as
// closureResolution() returns them.
function assertResolutionParity(accepted, observed, { lane }) {
  assertResolutionDigest(accepted, 'Accepted source resolution');
  assertResolutionDigest(observed, `${lane} resolution`);
  if (observed.closureSha256 === accepted.closureSha256) {
    return {
      closureSha256: observed.closureSha256,
      packageCount: observed.closureIdentities.length,
    };
  }
  const drift = resolutionDrift(
    accepted.closureIdentities,
    observed.closureIdentities,
  );
  throw new Error(
    [
      `${lane} resolution differs from the closure the source lane accepted (${drift.length} package(s)):`,
      ...drift.map(line => `  - ${line}`),
      'The registry now resolves dependencies the source lane never built or ran. A version change usually means a third-party release matured between the two lanes; release the next version so its source lane accepts today’s closure. An integrity change means the registry serves different bytes for an accepted version; investigate it before promoting anything.',
    ].join('\n'),
  );
}

export { assertResolutionParity, resolutionDrift };
