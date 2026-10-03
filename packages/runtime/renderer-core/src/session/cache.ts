import { identityCacheKey, type RendererIdentity } from '../identity';
import type { ResponsePolicy } from './types';

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

export function permitsDocumentCache(policy: ResponsePolicy): boolean {
  if (
    policy.kind !== 'document' ||
    policy.status !== 200 ||
    policy.cache.mode !== 'public'
  ) {
    return false;
  }
  const headers = new Headers(
    policy.headers.map(([name, value]): [string, string] => [name, value]),
  );
  const cacheControl = headers.get('cache-control') ?? '';
  if (
    headers.has('set-cookie') ||
    /(?:^|,)\s*(?:private|no-store|no-cache)(?:\s|,|=|$)/i.test(cacheControl) ||
    headers
      .get('vary')
      ?.split(',')
      .some(value => value.trim() === '*')
  ) {
    return false;
  }
  return (
    headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ===
    'text/html'
  );
}
