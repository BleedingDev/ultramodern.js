// G13b-support: zone policy evaluation over a surface diff + publication zone.
//
// Given a comparator result (compare-mf / compare-rest / compare-rpc, any of
// which expose `classification` and `sideBySide.satisfied`) and the surface's
// publication metadata, decide whether the change is allowed under ADR-0020's
// zoned policy:
//
//   - unknown/misspelled zone, or a malformed diff (classification not
//                additive|breaking) -> error (fail-closed; never defaults).
//   - coordinated  -> breaking changes are allowed; emit a report-only note.
//   - external, incomplete metadata (missing any of owner / kind / major /
//                baselineCompatibility / retirement) -> error.
//   - external breaking WITHOUT a side-by-side new major -> error.
//   - external additive or side-by-side-major breaking -> pass (with note).
//
// Publication input (mirrors delivery-unit-schema PublicationZone plus the
// owner/kind that live on the unit/surface, documented in ./CONTRACT-SHAPES.md):
//   {
//     zone: 'coordinated' | 'external',
//     owner?: string,
//     kind?: string,
//     external?: { surfaceMajor: number, baselineCompatibility: string,
//                  retirement: { supersededBy?: string, sunsetAfter?: string } }
//   }

const REQUIRED_EXTERNAL_FIELDS = [
  'owner',
  'kind',
  'major',
  'baselineCompatibility',
  'retirement',
];

/**
 * @param {{ zone?: string, owner?: string, kind?: string, external?: object }} publication
 * @returns {{ complete: boolean, missing: string[] }}
 */
function checkCompleteMetadata(publication) {
  const present = {
    owner:
      typeof publication.owner === 'string' && publication.owner.length > 0,
    kind: typeof publication.kind === 'string' && publication.kind.length > 0,
    major: typeof publication.external?.surfaceMajor === 'number',
    baselineCompatibility:
      typeof publication.external?.baselineCompatibility === 'string' &&
      publication.external.baselineCompatibility.length > 0,
    retirement:
      publication.external?.retirement != null &&
      typeof publication.external.retirement === 'object',
  };
  const missing = REQUIRED_EXTERNAL_FIELDS.filter(f => !present[f]);
  return { complete: missing.length === 0, missing };
}

/**
 * @param {{ classification?: string, sideBySide?: { satisfied?: boolean }, surfaceId?: string }} diff
 * @param {object} publication
 * @returns {{
 *   zone: string, surfaceId: string, classification: string,
 *   verdict: 'pass' | 'pass-with-note' | 'fail',
 *   notes: string[], errors: string[]
 * }}
 */
const KNOWN_ZONES = new Set(['coordinated', 'external']);
const KNOWN_CLASSIFICATIONS = new Set(['additive', 'breaking']);

export function evaluateZonePolicy({ diff, publication }) {
  const zone = publication?.zone ?? 'coordinated';
  const surfaceId = diff?.surfaceId ?? '';

  // Fail-CLOSED on unrecognised input. An unknown/misspelled zone or a malformed
  // diff must NOT silently default to coordinated/additive (that would wave a
  // typo'd external surface through). Both are an 'error' verdict.
  if (!KNOWN_ZONES.has(zone)) {
    return {
      zone,
      surfaceId,
      classification: diff?.classification ?? 'unknown',
      verdict: 'error',
      notes: [],
      errors: [
        `unknown publication zone "${zone}" (expected one of: ${[...KNOWN_ZONES].join(', ')})`,
      ],
    };
  }
  if (
    diff == null ||
    typeof diff !== 'object' ||
    !KNOWN_CLASSIFICATIONS.has(diff.classification)
  ) {
    return {
      zone,
      surfaceId,
      classification: 'unknown',
      verdict: 'error',
      notes: [],
      errors: [
        `malformed surface diff: classification must be one of ${[...KNOWN_CLASSIFICATIONS].join(', ')} (got ${JSON.stringify(diff?.classification)})`,
      ],
    };
  }

  const classification = diff.classification;
  const breaking = classification === 'breaking';
  const sideBySide = Boolean(diff?.sideBySide?.satisfied);
  const notes = [];
  const errors = [];

  if (zone !== 'external') {
    if (breaking) {
      notes.push(
        'coordinated-zone breaking change: allowed (report-only). In-repo consumers must be updated in the same change; runtime skew covered by degraded-state handling (ADR-0020).',
      );
      return {
        zone,
        surfaceId,
        classification,
        verdict: 'pass-with-note',
        notes,
        errors,
      };
    }
    return { zone, surfaceId, classification, verdict: 'pass', notes, errors };
  }

  // external zone
  const { complete, missing } = checkCompleteMetadata(publication ?? {});
  if (!complete) {
    errors.push(
      `externally published surface has incomplete metadata; missing: ${missing.join(', ')} (ADR-0020 requires owner, kind, major, baselineCompatibility, retirement)`,
    );
  }

  if (breaking && !sideBySide) {
    errors.push(
      'external surface breaking change without a side-by-side new major (ADR-0020: a breaking change must ship as a new major exposed alongside the previous major)',
    );
  }

  if (errors.length > 0) {
    return { zone, surfaceId, classification, verdict: 'fail', notes, errors };
  }

  if (breaking) {
    notes.push(
      'external breaking change permitted: complete metadata and side-by-side new major present',
    );
    return {
      zone,
      surfaceId,
      classification,
      verdict: 'pass-with-note',
      notes,
      errors,
    };
  }
  return { zone, surfaceId, classification, verdict: 'pass', notes, errors };
}
