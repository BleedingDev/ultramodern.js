// Stable structural hash for contract subsets (params / response schema / rpc
// operation shape). Pure node ESM, no deps. Used only when a contract does not
// carry a precomputed signature/hash of its own.
import { createHash } from 'node:crypto';

/**
 * Deterministically stringify a JSON value with object keys sorted, so that
 * key-order differences never register as contract changes.
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

/**
 * Stable sha256 (hex, 16 chars) of any JSON-serialisable value.
 * @param {unknown} value
 * @returns {string}
 */
export function stableHash(value) {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, 16);
}
