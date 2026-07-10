// G15 / G18: baseline-cohort compatibility validation.
//
// An externally published unit declares which baseline range it is compatible
// with (CONTEXT.md Platform Baseline; delivery-unit-schema BaselineCohort +
// ExternalPublication.baselineCompatibility). A host provisions the Platform
// Baseline with EXACT pins (the composition-time singletons: React, TanStack
// Router, Effect, Tailwind). This module produces compatible/incompatible
// verdicts for each unit against the host, and enforces the singleton
// intersection rule: two units composed on one host that demand disjoint majors
// of a singleton baseline dependency cannot both be satisfied → host fails.
//
// Inputs (documented in ./CONTRACT-SHAPES.md):
//   host: { pins: { react, tanstackRouter, effect, tailwind } }   // exact strings
//   units: [ {
//     unitId: string,
//     baselineCohort: { cohortId, resolved: { react, tanstackRouter, effect, tailwind } },
//     baselineCompatibility?: {
//       // per-dep accepted majors; when omitted a dep accepts only the major of
//       // its own resolved cohort pin (exact-major compatibility).
//       react?: { majors: number[] }, tanstackRouter?: {...}, effect?: {...}, tailwind?: {...}
//     }
//   } ]

const SINGLETONS = ['react', 'tanstackRouter', 'effect', 'tailwind'];

/**
 * Extract the semver major from a pin string. Handles exact (`19.0.0`), ranges
 * (`^18.2.0`, `>=18`), and prereleases (`4.0.0-beta.94`).
 * @param {string} pin
 * @returns {number | null}
 */
export function majorOf(pin) {
  if (typeof pin !== 'string') return null;
  const m = /(\d+)/.exec(pin);
  return m ? Number(m[1]) : null;
}

/** Accepted majors a unit declares for a singleton dependency. */
function acceptedMajors(unit, dep) {
  const declared = unit.baselineCompatibility?.[dep]?.majors;
  if (Array.isArray(declared) && declared.length > 0) return declared.slice();
  const resolved = unit.baselineCohort?.resolved?.[dep];
  const major = majorOf(resolved);
  return major === null ? [] : [major];
}

/**
 * @param {{ pins: Record<string, string> }} host
 * @param {Array<object>} units
 * @returns {{
 *   compatible: boolean,
 *   units: Array<{ unitId: string, compatible: boolean, reasons: string[], mismatches: object[] }>,
 *   singletonConflicts: Array<{ dependency: string, unitMajors: object, reason: string }>,
 *   errors: string[]
 * }}
 */
export function checkBaselineCompatibility({ host, units }) {
  const errors = [];
  const hostPins = host?.pins ?? {};
  const unitReports = [];

  for (const unit of units ?? []) {
    const reasons = [];
    const mismatches = [];
    for (const dep of SINGLETONS) {
      const hostMajor = majorOf(hostPins[dep]);
      const accepted = acceptedMajors(unit, dep);
      if (hostMajor === null) {
        reasons.push(`host provides no ${dep} pin`);
        mismatches.push({ dependency: dep, hostMajor: null, accepted });
        continue;
      }
      if (!accepted.includes(hostMajor)) {
        reasons.push(
          `${dep}: host pins v${hostMajor}, unit accepts {${accepted.map(m => `v${m}`).join(', ') || '∅'}}`,
        );
        mismatches.push({ dependency: dep, hostMajor, accepted });
      }
    }
    unitReports.push({
      unitId: unit.unitId ?? '',
      compatible: reasons.length === 0,
      reasons,
      mismatches,
    });
  }

  // Singleton intersection rule: across all units, each singleton dependency
  // must have a non-empty intersection of accepted majors.
  const singletonConflicts = [];
  if ((units ?? []).length > 1) {
    for (const dep of SINGLETONS) {
      const sets = units.map(u => new Set(acceptedMajors(u, dep)));
      let intersection = [...sets[0]];
      for (const s of sets.slice(1))
        intersection = intersection.filter(m => s.has(m));
      if (intersection.length === 0) {
        singletonConflicts.push({
          dependency: dep,
          unitMajors: Object.fromEntries(
            units.map(u => [u.unitId ?? '', acceptedMajors(u, dep)]),
          ),
          reason: `units demand disjoint ${dep} majors; no single ${dep} singleton can satisfy this host`,
        });
      }
    }
  }

  const compatible =
    unitReports.every(u => u.compatible) && singletonConflicts.length === 0;

  return { compatible, units: unitReports, singletonConflicts, errors };
}
