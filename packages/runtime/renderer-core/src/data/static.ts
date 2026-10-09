import { MAX_DATA_BYTES } from './codec';
import { DATA_CONTENT_TYPE, DATA_STREAM_CONTENT_TYPE } from './types';

/** Head marker written into documents produced by static prerendering. */
export const PRERENDERED_DOCUMENT_META = 'ultramodern-prerendered';
/** Directory beside a prerendered document that holds its loader payloads. */
export const STATIC_DATA_DIRECTORY = '__ultramodern-data';

/** A loader response captured at build time, replayed by the data client. */
export interface StaticDataPayload {
  status: number;
  contentType: typeof DATA_CONTENT_TYPE | typeof DATA_STREAM_CONTENT_TYPE;
  body: string;
}

function encodeRouteId(routeId: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(routeId))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

/** URL path of one route's loader payload for a search-free document path. */
export function staticDataPayloadPath(
  pathname: string,
  routeId: string,
): string {
  if (!routeId) throw new TypeError('A static data payload needs a route ID');
  const directory = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${directory}${STATIC_DATA_DIRECTORY}/${encodeRouteId(routeId)}.json`;
}

/**
 * The client reads a payload file whole before replaying it. One response
 * wrapped as a JSON string can grow up to six times through escaping; a
 * deferred stream's frames are bounded only one by one, so prerendering
 * checks the whole file against the same limit.
 */
export const STATIC_DATA_PAYLOAD_MAX_BYTES = MAX_DATA_BYTES * 6 + 1024;

/** The payload file's text, or an error when the client could not read it. */
export function encodeStaticDataPayload(payload: StaticDataPayload): string {
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > STATIC_DATA_PAYLOAD_MAX_BYTES)
    throw new RangeError(
      `A static loader payload of ${bytes} bytes exceeds the ${STATIC_DATA_PAYLOAD_MAX_BYTES} bytes the data client replays; reduce its (deferred) data or serve the route dynamically.`,
    );
  return text;
}

export function isStaticDataPayload(
  value: unknown,
): value is StaticDataPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const payload = value as Record<string, unknown>;
  return (
    Number.isInteger(payload.status) &&
    (payload.status as number) >= 200 &&
    (payload.status as number) <= 599 &&
    (payload.contentType === DATA_CONTENT_TYPE ||
      payload.contentType === DATA_STREAM_CONTENT_TYPE) &&
    typeof payload.body === 'string'
  );
}

/** Whether the current browser document was emitted by static prerendering. */
export function isPrerenderedDocument(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.querySelector(`meta[name="${PRERENDERED_DOCUMENT_META}"]`) !== null
  );
}
