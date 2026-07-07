import type { Context, ServerEnv } from '@modern-js/server-core';
import { DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES } from './constants';
import { createRuntimeSignalError } from './errors';
import {
  normalizeRuntimeSignalAppName,
  normalizeRuntimeSignalOrigin,
  normalizeRuntimeSignalRuntimeDigest,
} from './source';
import type { RuntimeFallbackSignalSource } from './types';

function getUtf8ByteLength(input: string) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(input);
  }
  return new TextEncoder().encode(input).length;
}

export async function parseRuntimeFallbackSignalPayload(
  c: Context<ServerEnv>,
  maxBodyBytes: number,
) {
  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw createRuntimeSignalError(
        'runtime fallback signal payload too large',
        'PAYLOAD_TOO_LARGE',
      );
    }
  }

  const rawBody = await c.req.raw.text();
  const payload = parseRuntimeFallbackSignalPayloadFromRawBody(
    rawBody,
    maxBodyBytes,
  );
  return {
    rawBody,
    payload,
  };
}

export function parseRuntimeFallbackSignalPayloadFromRawBody(
  rawBody: string,
  maxBodyBytes: number,
) {
  if (!rawBody || rawBody.trim().length === 0) {
    throw createRuntimeSignalError(
      'runtime fallback signal body is empty',
      'INVALID_PAYLOAD',
    );
  }
  if (getUtf8ByteLength(rawBody) > maxBodyBytes) {
    throw createRuntimeSignalError(
      'runtime fallback signal payload too large',
      'PAYLOAD_TOO_LARGE',
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (_error) {
    throw createRuntimeSignalError(
      'runtime fallback signal body must be valid JSON',
      'INVALID_PAYLOAD',
    );
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createRuntimeSignalError(
      'runtime fallback signal body must be a JSON object',
      'INVALID_PAYLOAD',
    );
  }

  return payload as Record<string, unknown>;
}
