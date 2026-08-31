// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import { isPlainObject } from '../codec';
import type {
  DataBatchBody,
  DataBatchHeader,
  DataBatchResponseItem,
} from '../types';

const BASE64_CHUNK_SIZE = 0x8000;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const RESPONSE_BLOCKED_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export function encodeBatchBody(bytes: Uint8Array): DataBatchBody {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE),
    );
  }
  return { encoding: 'base64', data: btoa(binary) };
}

export function encodeBatchText(value: string): DataBatchBody {
  return encodeBatchBody(new TextEncoder().encode(value));
}

export function decodeBatchBody(body: DataBatchBody): Uint8Array<ArrayBuffer> {
  const binary = atob(body.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isBatchBody(value: unknown): value is DataBatchBody {
  return (
    isPlainObject(value) &&
    value.encoding === 'base64' &&
    typeof value.data === 'string' &&
    CANONICAL_BASE64.test(value.data) &&
    btoa(atob(value.data)) === value.data
  );
}

export function isBatchHeaderList(value: unknown): value is DataBatchHeader[] {
  return (
    Array.isArray(value) &&
    value.every(
      entry =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string',
    )
  );
}

export function isNullBodyStatus(status: number) {
  return NULL_BODY_STATUSES.has(status);
}

export function toBatchResponseHeaders(headers: Headers): DataBatchHeader[] {
  const connectionHeaders = new Set(
    (headers.get('connection') || '')
      .split(',')
      .map(header => header.trim().toLowerCase())
      .filter(Boolean),
  );
  const output: DataBatchHeader[] = [];
  headers.forEach((value, name) => {
    const normalizedName = name.toLowerCase();
    if (
      !RESPONSE_BLOCKED_HEADERS.has(normalizedName) &&
      !connectionHeaders.has(normalizedName)
    ) {
      output.push([normalizedName, value]);
    }
  });
  return output;
}

export async function toBatchResponseItem(
  id: string,
  response: Response,
  omitBody = false,
): Promise<DataBatchResponseItem> {
  const body =
    omitBody || response.body === null
      ? undefined
      : encodeBatchBody(new Uint8Array(await response.arrayBuffer()));
  return {
    id,
    status: response.status,
    headers: toBatchResponseHeaders(response.headers),
    ...(body ? { body } : {}),
  };
}
