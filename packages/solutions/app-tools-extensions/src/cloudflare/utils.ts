import path from 'node:path';
import type { JsonValue } from '../config';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const normalizeRelativePath = (
  value: unknown,
  label: string,
  scope = 'app output',
  options: { allowRoot?: boolean } = {},
) => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a relative path inside the ${scope}.`);
  }

  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/u, '')
    .replace(/\/+$/u, '');
  const segments = normalized.split('/');
  const isRootDestination = normalized === '.';

  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    (!options.allowRoot && isRootDestination) ||
    segments.includes('..')
  ) {
    throw new Error(`${label} must be a relative path inside the ${scope}.`);
  }

  return normalized;
};

export const isJsonRecord = (
  value: unknown,
): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
