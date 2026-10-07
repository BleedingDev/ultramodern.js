import { createHash } from 'node:crypto';
import type { ReleaseEnvelope, ReleaseEnvelopePayload } from './types';

export { releaseEnvelopePayload } from './contract.mjs';

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

const serializeCanonicalValue = (value: CanonicalValue): string => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Canonical release-envelope values must be finite.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeCanonicalValue).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${serializeCanonicalValue(value[key] as CanonicalValue)}`,
    )
    .join(',')}}`;
};

export const canonicalSerializeMicroVerticalReleaseEnvelopePayload = (
  payload: ReleaseEnvelopePayload,
) => serializeCanonicalValue(payload as unknown as CanonicalValue);

export const canonicalSerializeMicroVerticalReleaseEnvelope = (
  envelope: ReleaseEnvelope,
) => serializeCanonicalValue(envelope as unknown as CanonicalValue);

export const digestMicroVerticalReleaseEnvelopePayload = (
  payload: ReleaseEnvelopePayload,
) =>
  createHash('sha256')
    .update(canonicalSerializeMicroVerticalReleaseEnvelopePayload(payload))
    .digest('hex');
