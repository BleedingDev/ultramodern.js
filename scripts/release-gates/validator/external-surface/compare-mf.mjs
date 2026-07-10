// G14-MF: Module Federation surface comparator.
//
// Contract shape (minimal, documented in ./CONTRACT-SHAPES.md):
//   {
//     kind: 'mf',
//     surfaceId: string,
//     exposes: [ { path: './cart', signature: string, major?: number } ]
//   }
// `signature` is an opaque per-expose type-signature hash/string produced by the
// surface owner. `major` is the externally published semver major that the
// expose path materialises (ADR-0020 §materialization: a new exposed MF path
// such as `./checkout/v2`). When `major` is absent it is derived from a
// trailing `/vN` path segment, else treated as major 1.
//
// Classification (per surfaceId): a change is ADDITIVE when the new contract only
// adds expose paths; it is BREAKING when any previously published expose path is
// removed or has its signature mutated in place. Under ADR-0020 an externally
// published major is immutable: a breaking change must ship as a NEW major path
// exposed side by side with the retained old-major path.

/**
 * @typedef {{ path: string, signature?: string, major?: number, [k: string]: unknown }} MfExpose
 * @typedef {{ kind?: string, surfaceId?: string, exposes?: MfExpose[] }} MfContract
 */

const MAJOR_SUFFIX = /\/v([1-9]\d*)$/;

/**
 * Logical id of an expose: its path with any trailing `/vN` major segment
 * removed, so `./cart` and `./cart/v2` share the logical id `./cart`.
 * @param {MfExpose} expose
 */
function logicalId(expose) {
  return expose.path.replace(MAJOR_SUFFIX, '');
}

/** @param {MfExpose} expose */
function exposeMajor(expose) {
  if (typeof expose.major === 'number') return expose.major;
  const m = MAJOR_SUFFIX.exec(expose.path);
  return m ? Number(m[1]) : 1;
}

/**
 * A signature is only trustworthy when the owner emitted an explicit string.
 * A path-only expose (no `signature`) is NEVER signature-verified: there is no
 * structural-hash fallback (that silently manufactured a "signature" from the
 * whole object). Such exposes are unverifiable — additive-on-add,
 * breaking-on-removal, and treated as UNCHANGED in place (a signature mutation
 * cannot be detected without a signature). See ./CONTRACT-SHAPES.md.
 * @param {MfExpose} expose
 */
function exposeSignature(expose) {
  return typeof expose.signature === 'string' ? expose.signature : null;
}

/** @param {MfContract} contract */
function indexExposes(contract) {
  const byPath = new Map();
  for (const expose of contract?.exposes ?? []) {
    byPath.set(expose.path, expose);
  }
  return byPath;
}

/**
 * Compare two MF surface contracts.
 * @param {MfContract} oldContract
 * @param {MfContract} newContract
 * @param {{ zone?: 'coordinated' | 'external' }} [options]
 * @returns {{
 *   kind: 'mf', surfaceId: string, zone: string,
 *   changes: Array<{ path: string, type: 'added'|'removed'|'changed'|'unchanged'|'unverifiable' }>,
 *   classification: 'additive' | 'breaking',
 *   breakingChanges: Array<{ path: string, reason: string }>,
 *   majorsAdded: number[],
 *   sideBySide: { satisfied: boolean, details: string },
 *   verdict: 'pass' | 'pass-with-note' | 'fail',
 *   notes: string[], errors: string[]
 * }}
 */
export function compareMfSurface(oldContract, newContract, options = {}) {
  const zone = options.zone ?? 'coordinated';
  const surfaceId = newContract?.surfaceId ?? oldContract?.surfaceId ?? '';
  const errors = [];
  const notes = [];

  const oldByPath = indexExposes(oldContract);
  const newByPath = indexExposes(newContract);

  const changes = [];
  const breakingChanges = [];

  // Removed / changed relative to old.
  for (const [path, oldExpose] of oldByPath) {
    const newExpose = newByPath.get(path);
    if (!newExpose) {
      // Breaking-on-removal holds even for signature-less path-only contracts.
      changes.push({ path, type: 'removed' });
      breakingChanges.push({ path, reason: 'expose path removed' });
      continue;
    }
    const oldSig = exposeSignature(oldExpose);
    const newSig = exposeSignature(newExpose);
    if (oldSig === null || newSig === null) {
      // Unverifiable: no owner-emitted signature on one/both sides. The path is
      // present in both, so it is not a removal; without a signature a mutation
      // cannot be verified, so it is NOT reported as a breaking change.
      changes.push({ path, type: 'unverifiable' });
      notes.push(
        `expose ${path} has no owner-emitted signature; unverifiable (path present, not signature-verified)`,
      );
    } else if (oldSig !== newSig) {
      changes.push({ path, type: 'changed' });
      breakingChanges.push({
        path,
        reason: 'expose signature changed in place',
      });
    } else {
      changes.push({ path, type: 'unchanged' });
    }
  }
  // Added relative to old.
  const majorsAdded = [];
  for (const [path, newExpose] of newByPath) {
    if (!oldByPath.has(path)) {
      changes.push({ path, type: 'added' });
      const major = exposeMajor(newExpose);
      if (major > 1) majorsAdded.push(major);
    }
  }

  const classification = breakingChanges.length > 0 ? 'breaking' : 'additive';

  // Side-by-side: every retained old-major logical id still present AND at least
  // one strictly-greater major added for it (a new major exposed alongside old).
  const oldLogicals = new Set([...oldByPath.values()].map(logicalId));
  let sideBySideSatisfied = false;
  let details = 'no new external major introduced';
  if (majorsAdded.length > 0) {
    const addedLogicals = [...newByPath.values()]
      .filter(e => !oldByPath.has(e.path) && exposeMajor(e) > 1)
      .map(logicalId);
    const retained = [...oldByPath.keys()].every(p => newByPath.has(p));
    // Old-major surface must be UNCHANGED, not merely present: mutating the v1
    // signature while adding v2 must NOT satisfy side-by-side (immutable major).
    const oldUnchanged = [...oldByPath].every(([p, e]) => {
      if (!newByPath.has(p)) return false;
      const a = exposeSignature(e);
      const b = exposeSignature(newByPath.get(p));
      // Unverifiable paths (no signature) cannot be proven mutated; keep them
      // from blocking. Only a verified signature mismatch breaks immutability.
      return a === null || b === null || a === b;
    });
    const coversOld = addedLogicals.some(id => oldLogicals.has(id));
    sideBySideSatisfied = retained && oldUnchanged && coversOld;
    details = sideBySideSatisfied
      ? 'new major exposed side by side with retained, unchanged previous major'
      : !retained
        ? 'previous-major expose paths not retained alongside new major'
        : !oldUnchanged
          ? 'previous-major expose signature mutated in place; a published major is immutable'
          : 'new major added but does not correspond to a retained logical expose';
  }

  let verdict = 'pass';
  if (classification === 'breaking') {
    if (zone === 'external') {
      if (sideBySideSatisfied) {
        verdict = 'pass-with-note';
        notes.push(
          'external breaking change materialised as side-by-side new major',
        );
      } else {
        verdict = 'fail';
        errors.push(
          'external MF surface breaking change without a side-by-side new major (ADR-0020): ' +
            breakingChanges.map(b => `${b.path} (${b.reason})`).join('; '),
        );
      }
    } else {
      verdict = 'pass-with-note';
      notes.push(
        'coordinated-zone breaking change permitted; in-repo consumers must update in-change',
      );
    }
  } else if (majorsAdded.length > 0) {
    verdict = 'pass-with-note';
    notes.push(`additive new major(s) introduced: v${majorsAdded.join(', v')}`);
  }

  return {
    kind: 'mf',
    surfaceId,
    zone,
    changes,
    classification,
    breakingChanges,
    majorsAdded,
    sideBySide: { satisfied: sideBySideSatisfied, details },
    verdict,
    notes,
    errors,
  };
}
