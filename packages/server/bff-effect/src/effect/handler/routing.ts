// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { isPlainObject } from '../../data-platform';

export function getRequestPathname(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return new URL(request.url, 'http://localhost').pathname;
  }
}

function normalizeMountPrefix(prefix: string) {
  if (!prefix || prefix === '/') {
    return '';
  }
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

export function getMountedPrefixFromContext(
  request: Request,
  context: unknown,
): string {
  if (!isPlainObject(context) || typeof context.path !== 'string') {
    return '';
  }

  const contextPath = normalizeMountPrefix(context.path);
  const requestPath = normalizeMountPrefix(getRequestPathname(request));

  if (
    !contextPath ||
    !requestPath ||
    contextPath === requestPath ||
    !contextPath.endsWith(requestPath)
  ) {
    return '';
  }

  return normalizeMountPrefix(
    contextPath.slice(0, contextPath.length - requestPath.length),
  );
}

export function removeMountedPrefixFromBatchPath(
  pathWithQuery: string,
  prefix: string,
) {
  const normalizedPrefix = normalizeMountPrefix(prefix);
  if (!normalizedPrefix) {
    return pathWithQuery;
  }

  const [pathname, ...queryParts] = pathWithQuery.split('?');
  if (!pathname) {
    return pathWithQuery;
  }

  let nextPathname = pathname;
  if (pathname === normalizedPrefix) {
    nextPathname = '/';
  } else if (pathname.startsWith(`${normalizedPrefix}/`)) {
    const sliced = pathname.slice(normalizedPrefix.length);
    nextPathname = sliced.startsWith('/') ? sliced : `/${sliced}`;
  }

  if (queryParts.length === 0) {
    return nextPathname;
  }
  return `${nextPathname}?${queryParts.join('?')}`;
}

function getRequestOrigin(request: Request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return new URL(request.url, 'http://localhost').origin;
  }
}

export function getExpectedEnvelopeOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') {
    return origin;
  }
  return getRequestOrigin(request);
}

export function isRpcRequest(request: Request, rpcPath: `/${string}`) {
  const pathname = getRequestPathname(request);
  return pathname === rpcPath || pathname.startsWith(`${rpcPath}/`);
}
