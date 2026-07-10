// G14-REST: REST / HttpApi route surface comparator.
//
// Contract shape (aligned with the operation records emitted by
// packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts — each op
// carries `method` + `path`; here we additionally carry the compared
// params/response subset):
//   {
//     kind: 'rest',
//     surfaceId: string,
//     routes: [ {
//       method: 'GET', path: '/orders/:id',
//       params?: object[], response?: object,   // subset compared structurally
//       responseHash?: string,                  // precomputed alternative
//       major?: number
//     } ]
//   }
// A route key is `METHOD path`. ADR-0020 §materialization: a REST major
// materialises as a new route prefix (e.g. `/v2/orders`). A published external
// prefix is immutable; a breaking change ships as a new prefix served side by
// side with the old one.
import { stableHash } from './hash.mjs';

const PREFIX = /^\/v([1-9]\d*)(?=\/)/;

/** @param {{ method?: string, path: string }} route */
function routeKey(route) {
  return `${String(route.method ?? 'GET').toUpperCase()} ${route.path}`;
}

/** Logical id: method + path with any leading `/vN` prefix removed. */
function logicalId(route) {
  return `${String(route.method ?? 'GET').toUpperCase()} ${route.path.replace(PREFIX, '')}`;
}

function routeMajor(route) {
  if (typeof route.major === 'number') return route.major;
  const m = PREFIX.exec(route.path);
  return m ? Number(m[1]) : 1;
}

function routeSignature(route) {
  // Request params ALWAYS participate in the comparison. A precomputed
  // `responseHash` (when present) substitutes only for the response body; it
  // never replaces the params, so a params-only change is never masked.
  return stableHash({
    params: route.params ?? [],
    response: route.responseHash ?? route.response ?? null,
  });
}

function indexRoutes(contract) {
  const byKey = new Map();
  for (const route of contract?.routes ?? []) byKey.set(routeKey(route), route);
  return byKey;
}

/**
 * Compare two REST route surface contracts.
 * @param {object} oldContract
 * @param {object} newContract
 * @param {{ zone?: 'coordinated' | 'external' }} [options]
 */
export function compareRestSurface(oldContract, newContract, options = {}) {
  const zone = options.zone ?? 'coordinated';
  const surfaceId = newContract?.surfaceId ?? oldContract?.surfaceId ?? '';
  const errors = [];
  const notes = [];

  const oldByKey = indexRoutes(oldContract);
  const newByKey = indexRoutes(newContract);

  const changes = [];
  const breakingChanges = [];

  for (const [key, oldRoute] of oldByKey) {
    const newRoute = newByKey.get(key);
    if (!newRoute) {
      changes.push({ key, type: 'removed' });
      breakingChanges.push({ key, reason: 'route removed' });
    } else if (routeSignature(oldRoute) !== routeSignature(newRoute)) {
      changes.push({ key, type: 'changed' });
      breakingChanges.push({
        key,
        reason: 'route params/response changed in place',
      });
    } else {
      changes.push({ key, type: 'unchanged' });
    }
  }

  const majorsAdded = [];
  for (const [key, newRoute] of newByKey) {
    if (!oldByKey.has(key)) {
      changes.push({ key, type: 'added' });
      const major = routeMajor(newRoute);
      if (major > 1) majorsAdded.push(major);
    }
  }

  const classification = breakingChanges.length > 0 ? 'breaking' : 'additive';

  const oldLogicals = new Set([...oldByKey.values()].map(logicalId));
  let sideBySideSatisfied = false;
  let details = 'no new external major route prefix introduced';
  if (majorsAdded.length > 0) {
    const addedLogicals = [...newByKey.values()]
      .filter(r => !oldByKey.has(routeKey(r)) && routeMajor(r) > 1)
      .map(logicalId);
    const retained = [...oldByKey.keys()].every(k => newByKey.has(k));
    // Old-major surface must be UNCHANGED, not merely present: mutating a v1
    // route while adding v2 must NOT satisfy side-by-side (immutable major).
    const oldUnchanged = [...oldByKey].every(
      ([k, r]) =>
        newByKey.has(k) &&
        routeSignature(r) === routeSignature(newByKey.get(k)),
    );
    const coversOld = addedLogicals.some(id => oldLogicals.has(id));
    sideBySideSatisfied = retained && oldUnchanged && coversOld;
    details = sideBySideSatisfied
      ? 'new major route prefix served side by side with retained, unchanged previous prefix'
      : !retained
        ? 'previous-major routes not retained alongside new prefix'
        : !oldUnchanged
          ? 'previous-major route(s) mutated in place; a published major is immutable'
          : 'new major prefix added but does not correspond to a retained route';
  }

  let verdict = 'pass';
  if (classification === 'breaking') {
    if (zone === 'external') {
      if (sideBySideSatisfied) {
        verdict = 'pass-with-note';
        notes.push(
          'external breaking change materialised as side-by-side new route prefix',
        );
      } else {
        verdict = 'fail';
        errors.push(
          'external REST surface breaking change without a side-by-side new major prefix (ADR-0020): ' +
            breakingChanges.map(b => `${b.key} (${b.reason})`).join('; '),
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
    notes.push(
      `additive new major route prefix(es): v${majorsAdded.join(', v')}`,
    );
  }

  return {
    kind: 'rest',
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
