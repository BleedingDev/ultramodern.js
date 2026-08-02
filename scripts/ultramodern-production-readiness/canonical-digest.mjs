import { createHash } from 'node:crypto';

function canonicalSerialize(value) {
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Canonical evidence values must be finite.');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`)
      .join(',')}}`;
  }
  throw new Error('Canonical evidence contains an unsupported value.');
}

function digestCanonical(value) {
  return createHash('sha256')
    .update(canonicalSerialize(value), 'utf8')
    .digest('hex');
}

export { canonicalSerialize, digestCanonical };
