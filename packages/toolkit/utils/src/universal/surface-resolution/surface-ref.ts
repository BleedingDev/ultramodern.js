/**
 * SurfaceRef grammar (MV-G25a).
 *
 * Mirrors the EBNF in `packages/toolkit/create/delivery-unit-schema-SPEC.md` §2
 * exactly:
 *
 * ```ebnf
 * SurfaceRef   = UnitId , "#" , SurfaceId , [ "@" , Major ] ;
 * UnitId       = Segment , { "/" , Segment } ;
 * SurfaceId    = Segment ;
 * Segment      = SegmentChar , { SegmentChar } ;
 * SegmentChar  = letter | digit | "-" | "_" | "." ;
 * Major        = "v" , nonzero , { digit } ;
 * ```
 *
 * Canonical form: `unitId#surfaceId` with optional `@vN` external-major suffix
 * (e.g. `acme/checkout#cart`, `acme/checkout#cart@v2`). Universal module:
 * dependency-free, runs in any JavaScript environment.
 */

/**
 * Parsed form of a SurfaceRef. Canonical string form is `unitId#surfaceId`
 * with an optional `@vN` major suffix.
 */
export type ParsedSurfaceRef = {
  unitId: string;
  surfaceId: string;
  /** External-major selector. Absent means "the coordinated-zone surface". */
  major?: number;
};

export type SurfaceRefParseError =
  | { code: 'empty' }
  | { code: 'missing-surface-separator' }
  | { code: 'multiple-surface-separators' }
  | { code: 'empty-unit-id' }
  | { code: 'invalid-unit-id'; segment: string }
  | { code: 'empty-surface-id' }
  | { code: 'invalid-surface-id' }
  | { code: 'empty-major' }
  | { code: 'invalid-major'; value: string };

export type SurfaceRefParseResult =
  | { ok: true; ref: ParsedSurfaceRef }
  | { ok: false; error: SurfaceRefParseError };

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAJOR_PATTERN = /^v[1-9][0-9]*$/;

/**
 * Parse a canonical SurfaceRef string. Total function: every rejection is a
 * typed {@link SurfaceRefParseError}; never throws.
 */
export function parseSurfaceRef(input: string): SurfaceRefParseResult {
  if (input === '') {
    return { ok: false, error: { code: 'empty' } };
  }

  const hashCount = countChar(input, '#');
  if (hashCount === 0) {
    return { ok: false, error: { code: 'missing-surface-separator' } };
  }
  if (hashCount > 1) {
    return { ok: false, error: { code: 'multiple-surface-separators' } };
  }

  const hashIndex = input.indexOf('#');
  const unitPart = input.slice(0, hashIndex);
  const rest = input.slice(hashIndex + 1);

  const atIndex = rest.indexOf('@');
  const surfaceId = atIndex === -1 ? rest : rest.slice(0, atIndex);
  const ref: ParsedSurfaceRef = { unitId: unitPart, surfaceId };

  if (atIndex !== -1) {
    const majorPart = rest.slice(atIndex + 1);
    if (majorPart === '') {
      return { ok: false, error: { code: 'empty-major' } };
    }
    if (!MAJOR_PATTERN.test(majorPart)) {
      return { ok: false, error: { code: 'invalid-major', value: majorPart } };
    }
    ref.major = Number(majorPart.slice(1));
  }

  const error = validateSurfaceRef(ref);
  return error === undefined ? { ok: true, ref } : { ok: false, error };
}

/**
 * Render a {@link ParsedSurfaceRef} back to its canonical string form.
 *
 * Direct inputs are checked against the same invariant as parsed references,
 * so this formatter cannot emit a string that {@link parseSurfaceRef} rejects.
 * Round-trip: `formatSurfaceRef(parseSurfaceRef(x).ref) === x` for valid `x`.
 */
export function formatSurfaceRef(ref: ParsedSurfaceRef): string {
  const error = validateSurfaceRef(ref);
  if (error !== undefined) {
    throw new TypeError(`Cannot format invalid SurfaceRef: ${error.code}.`);
  }

  const base = `${ref.unitId}#${ref.surfaceId}`;
  return ref.major === undefined ? base : `${base}@v${ref.major}`;
}

/** The shared semantic invariant for parsed and directly formatted references. */
export function validateSurfaceRef(
  ref: ParsedSurfaceRef,
): SurfaceRefParseError | undefined {
  if (ref.unitId === '') {
    return { code: 'empty-unit-id' };
  }
  for (const segment of ref.unitId.split('/')) {
    if (!SEGMENT_PATTERN.test(segment)) {
      return { code: 'invalid-unit-id', segment };
    }
  }

  if (ref.surfaceId === '') {
    return { code: 'empty-surface-id' };
  }
  if (!SEGMENT_PATTERN.test(ref.surfaceId)) {
    return { code: 'invalid-surface-id' };
  }

  if (
    ref.major !== undefined &&
    (!Number.isSafeInteger(ref.major) || ref.major < 1)
  ) {
    return { code: 'invalid-major', value: String(ref.major) };
  }

  return undefined;
}

function countChar(input: string, char: string): number {
  let count = 0;
  for (const current of input) {
    if (current === char) {
      count += 1;
    }
  }
  return count;
}
