import type { JsonRecord } from './types';

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
export const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const entries = value.map(canonicalizeJson);
    const keyedEntries = entries.every(
      (entry): entry is { id: string } =>
        entry !== null &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        'id' in entry &&
        typeof entry.id === 'string',
    );
    if (keyedEntries) {
      const ids = entries.map(entry => entry.id);
      if (new Set(ids).size === ids.length) {
        return entries.toSorted((left, right) =>
          left.id.localeCompare(right.id),
        );
      }
    }
    return entries;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map(key => [
          key,
          canonicalizeJson((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
};
export const sameJson = (actual: unknown, expected: unknown) =>
  JSON.stringify(canonicalizeJson(actual)) ===
  JSON.stringify(canonicalizeJson(expected));
export const formatJson = (value: unknown) =>
  value === undefined ? 'undefined' : JSON.stringify(canonicalizeJson(value));
export const selfCheckFailure = (
  contract: string,
  message: string,
  fixArea: string,
) =>
  `MicroVertical contract self-check failed: ${contract}. ${message}. Fix area: ${fixArea}.`;
export function assertSelfCheck(
  condition: unknown,
  contract: string,
  message: string,
  fixArea: string,
): asserts condition {
  assert(condition, selfCheckFailure(contract, message, fixArea));
}
export const assertSameJson = (
  actual: unknown,
  expected: unknown,
  contract: string,
  fixArea: string,
) => {
  assertSelfCheck(
    sameJson(actual, expected),
    contract,
    `Expected ${formatJson(expected)}, found ${formatJson(actual)}`,
    fixArea,
  );
};
// Project references and compiler inputs may include application-owned packages.
export const assertIncludesJson = (
  actual: unknown[],
  required: readonly unknown[],
  contract: string,
  fixArea: string,
) => {
  assertArray(actual, contract, fixArea);
  for (const entry of required) {
    assertSelfCheck(
      actual.some(value => sameJson(value, entry)),
      contract,
      `Missing required entry ${formatJson(entry)}`,
      fixArea,
    );
  }
};
export function assertObject(
  value: unknown,
  contract: string,
  fixArea: string,
): asserts value is JsonRecord {
  assertSelfCheck(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    contract,
    `Expected JSON object, found ${formatJson(value)}`,
    fixArea,
  );
}
export function assertArray(
  value: unknown,
  contract: string,
  fixArea: string,
): asserts value is JsonRecord[] {
  assertSelfCheck(
    Array.isArray(value),
    contract,
    `Expected JSON array, found ${formatJson(value)}`,
    fixArea,
  );
}
export const assertUniqueStrings = (
  values: readonly unknown[],
  contract: string,
) => {
  assert(Array.isArray(values), `${contract} must be an array`);
  const seen = new Set();
  for (const value of values) {
    assert(
      typeof value === 'string' && value.length > 0,
      `${contract} must contain non-empty strings`,
    );
    assert(!seen.has(value), `Duplicate value "${value}" in ${contract}`);
    seen.add(value);
  }
};
export const assertUniqueIdEntries = (
  entries: readonly JsonRecord[],
  contract: string,
) => {
  assert(Array.isArray(entries), `${contract} must be an array`);
  const seen = new Set();
  for (const entry of entries) {
    const id = entry?.id;
    assert(
      typeof id === 'string' && id.length > 0,
      `${contract} entries must have non-empty string ids`,
    );
    assert(!seen.has(id), `Duplicate id "${id}" in ${contract}`);
    seen.add(id);
  }
};
export const assertSameIdCohort = (
  entries: JsonRecord[] | undefined,
  expectedIds: readonly unknown[] | undefined,
  contract: string,
  fixArea: string,
) => {
  assert(entries && expectedIds, `${contract} must be an array`);
  assertUniqueIdEntries(entries, contract);
  assertSameJson(
    entries.map(entry => entry.id).toSorted(),
    [...expectedIds].toSorted(),
    `${contract} cohort`,
    fixArea,
  );
};
