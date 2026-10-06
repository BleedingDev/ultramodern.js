import { identityCacheKey, type RendererIdentity } from '../identity';
import type {
  DocumentCachePolicy,
  ResponseHeaders,
  ResponsePolicy,
} from './types';

type CacheMode = DocumentCachePolicy['mode'];

/** Compute this before looking up any application-provided request key. */
export function documentCacheKey(
  identity: RendererIdentity,
  requestKey: string,
): string {
  if (typeof requestKey !== 'string' || requestKey.length === 0) {
    throw new TypeError('A document cache request key must be nonempty.');
  }
  return JSON.stringify([identityCacheKey(identity), requestKey]);
}

/** Header fields with each Set-Cookie kept as its own entry. */
export function responseHeaders(headers: Headers): [string, string][] {
  const fields: [string, string][] = [];
  headers.forEach((value, name) => {
    if (name !== 'set-cookie') fields.push([name, value]);
  });
  for (const cookie of headers.getSetCookie()) {
    fields.push(['set-cookie', cookie]);
  }
  return fields;
}

export function policyHeaders(headers: ResponseHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of headers) result.append(name, value);
  return result;
}

const NO_STORE = { mode: 'no-store' as const, ages: [] };

/** Read Cache-Control. Malformed or repeated lifetimes never cache. */
function cacheDirectives(value: string | null): {
  mode: CacheMode;
  ages: number[];
} {
  let mode: CacheMode = 'public';
  const ages: number[] = [];
  const ageNames = new Set<string>();
  for (const part of value?.split(',') ?? []) {
    const match = /^\s*([!#$%&'*+.^_`|~\w-]+)(?:\s*=\s*([^\s]+))?\s*$/u.exec(
      part,
    );
    if (!match) return NO_STORE;
    const name = match[1].toLowerCase();
    if (name === 'no-store' || name === 'no-cache') mode = 'no-store';
    else if (name === 'private' && mode !== 'no-store') mode = 'private';
    if (name === 'max-age' || name === 's-maxage') {
      const age = Number(match[2]);
      if (
        ageNames.has(name) ||
        !/^\d+$/u.test(match[2] ?? '') ||
        !Number.isSafeInteger(age)
      ) {
        return NO_STORE;
      }
      ageNames.add(name);
      ages.push(age);
    }
  }
  return { mode, ages };
}

/** The most shareable mode these headers allow; lifetimes go into `ages`. */
function headerCacheMode(headers: Headers, ages: number[]): CacheMode {
  const control = cacheDirectives(headers.get('cache-control'));
  ages.push(...control.ages);
  if (
    headers.has('set-cookie') ||
    headers
      .get('vary')
      ?.split(',')
      .some(value => value.trim() === '*')
  ) {
    return 'no-store';
  }
  return control.mode;
}

function isSingleHtmlContentType(headers: Headers): boolean {
  const type = headers.get('content-type');
  return (
    !type?.includes(',') &&
    type?.split(';')[0].trim().toLowerCase() === 'text/html'
  );
}

export function permitsDocumentCache(policy: ResponsePolicy): boolean {
  if (
    policy.kind !== 'document' ||
    policy.status !== 200 ||
    policy.cache.mode !== 'public'
  ) {
    return false;
  }
  const headers = policyHeaders(policy.headers);
  return (
    headerCacheMode(headers, []) === 'public' &&
    isSingleHtmlContentType(headers)
  );
}

/**
 * Narrow a policy's cache to what every header source allows, then write the
 * matching Cache-Control to `outgoing`. Only a 200 HTML document can be public;
 * its lifetime is the shortest one any source declares.
 */
export function restrictDocumentCache(
  policy: ResponsePolicy,
  sources: readonly Headers[],
  outgoing: Headers,
): DocumentCachePolicy {
  const original = policyHeaders(policy.headers);
  let mode: CacheMode = policy.cache.mode;
  const ages =
    policy.cache.mode === 'public' ? [policy.cache.maxAgeSeconds] : [];
  for (const headers of [original, ...sources, outgoing]) {
    const restricted = headerCacheMode(headers, ages);
    if (restricted === 'no-store') mode = 'no-store';
    else if (restricted === 'private' && mode === 'public') mode = 'private';
  }
  if (
    policy.kind !== 'document' ||
    policy.status !== 200 ||
    !isSingleHtmlContentType(original) ||
    !isSingleHtmlContentType(outgoing)
  ) {
    mode = 'no-store';
  }
  if (mode === 'public') {
    const maxAgeSeconds = Math.min(...ages);
    outgoing.set(
      'cache-control',
      `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, must-revalidate`,
    );
    return { mode, maxAgeSeconds };
  }
  outgoing.set(
    'cache-control',
    mode === 'private' ? 'private, max-age=0, must-revalidate' : 'no-store',
  );
  return { mode };
}
