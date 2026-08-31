import { createHash } from 'node:crypto';
import type {
  MicroVerticalReleaseEnvelope,
  MicroVerticalReleaseEnvelopePayload,
} from './types';

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

export const releaseEnvelopePayload = (
  envelope: MicroVerticalReleaseEnvelope,
): MicroVerticalReleaseEnvelopePayload => ({
  schemaVersion: envelope.schemaVersion,
  kind: envelope.kind,
  target: envelope.target,
  identity: envelope.identity,
  artifacts: envelope.artifacts,
  surfaces: envelope.surfaces,
});

export const canonicalSerializeMicroVerticalReleaseEnvelopePayload = (
  payload: MicroVerticalReleaseEnvelopePayload,
) => serializeCanonicalValue(payload as unknown as CanonicalValue);

export const canonicalSerializeMicroVerticalReleaseEnvelope = (
  envelope: MicroVerticalReleaseEnvelope,
) => serializeCanonicalValue(envelope as unknown as CanonicalValue);

export const digestMicroVerticalReleaseEnvelopePayload = (
  payload: MicroVerticalReleaseEnvelopePayload,
) =>
  createHash('sha256')
    .update(canonicalSerializeMicroVerticalReleaseEnvelopePayload(payload))
    .digest('hex');
