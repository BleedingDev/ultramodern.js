/**
 * Cloudflare worker route data handler.
 *
 * Answers Modern.js route data requests (`?__loader=`) inside the worker with
 * the entry's route loaders, the way the Node server's data handler
 * (`@modern-js/plugin-data-loader/runtime` `handleRequest`) does: same route
 * IDs and localized route identity, same loader and action arguments, same
 * request context, same response encoding.
 *
 * It does not import react-router. The Node handler matches routes with
 * react-router's static handler, and react-router's main entry keeps
 * `Link -> PrefetchPageLinks -> import(route.module)` alive in minified worker
 * bundles, which the Cloudflare output verifier rejects. Route matching and
 * the static handler's route request semantics are ported below instead.
 *
 * Route matching, redirect normalization and route request handling are
 * modified from React Router 7.18.4
 * (https://github.com/remix-run/react-router/tree/react-router%407.18.4/packages/react-router/lib/router),
 * MIT Licensed, Copyright (c) Remix Software Inc. and React Training LLC.
 * Response encoding is modified from `@modern-js/plugin-data-loader/runtime`,
 * which is based on
 * https://github.com/remix-run/remix/blob/2b5e1a72fc628d0408e27cf4d72e537762f1dc5b/packages/remix-server-runtime/responses.ts,
 * MIT Licensed, Copyright 2021 Remix Software Inc.
 */
import { DeferredData } from '@modern-js/runtime-utils/browser';
import {
  createRequestContext,
  reporterCtx,
  serializeJson,
  storage,
} from '@modern-js/runtime-utils/node';
import { time } from '@modern-js/runtime-utils/time';
import { parseHeaders } from '@modern-js/runtime-utils/universal/request';
import {
  expandLocalisedLoaderRoutes,
  resolveLocalisedLoaderRoute,
} from '@modern-js/server-runtime-extensions/localised-loader';
import { LOADER_REPORTER_NAME } from '@modern-js/utils/universal/constants';

const LOADER_ID_PARAM = '__loader';
const CONTENT_TYPE_DEFERRED = 'text/modernjs-deferred';
const DEFERRED_VALUE_PLACEHOLDER_PREFIX = '__deferred_promise:';
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REQUEST_METHODS = new Set(['GET', ...MUTATION_METHODS]);
const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i;
const PARAM_SEGMENT_PATTERN = /^:[\w-]+$/;

function invariant(value, message) {
  if (value === false || value === null || typeof value === 'undefined') {
    throw new Error(message);
  }
}

// --- Route matching (react-router matchRoutes) -----------------------------

/**
 * Give loader routes the IDs and shape react-router gives the routes the
 * data loader runtime renders: a route's own `id`, or its position in the
 * tree, and no children on index routes.
 */
function createRouteTree(routes, parentPath = [], ids = new Set()) {
  return routes.map((loaderRoute, position) => {
    const treePath = [...parentPath, position];
    const id = loaderRoute.id || treePath.join('-');
    invariant(
      !ids.has(id),
      `Found a route id collision on id "${id}".  Route id's must be globally unique within Data Router usages`,
    );
    ids.add(id);
    const route = {
      id,
      caseSensitive: loaderRoute.caseSensitive,
      index: Boolean(loaderRoute.index),
      path: loaderRoute.path,
      loaderRoute,
    };
    if (!route.index && loaderRoute.children) {
      route.children = createRouteTree(loaderRoute.children, treePath, ids);
    }
    return route;
  });
}

const removeDoubleSlashes = path => path.replace(/[\\/]{2,}/g, '/');
const joinPaths = paths => removeDoubleSlashes(paths.join('/'));

function removeTrailingSlash(path, minLength = 0) {
  let end = path.length;
  while (end > minLength && path.charCodeAt(end - 1) === 47) {
    end--;
  }
  return end === path.length ? path : path.slice(0, end);
}

const normalizePathname = pathname =>
  removeTrailingSlash(pathname).replace(/^\/*/, '/');

function explodeOptionalSegments(path) {
  const segments = path.split('/');
  if (segments.length === 0) {
    return [];
  }
  const [first, ...rest] = segments;
  const isOptional = first.endsWith('?');
  const required = first.replace(/\?$/, '');
  if (rest.length === 0) {
    return isOptional ? [required, ''] : [required];
  }
  const restExploded = explodeOptionalSegments(rest.join('/'));
  const result = restExploded.map(subpath =>
    subpath === '' ? required : [required, subpath].join('/'),
  );
  if (isOptional) {
    result.push(...restExploded);
  }
  return result.map(exploded =>
    path.startsWith('/') && exploded === '' ? '/' : exploded,
  );
}

function computeScore(path, index) {
  const segments = path.split('/');
  let initialScore = segments.length;
  if (segments.some(segment => segment === '*')) {
    initialScore += -2;
  }
  if (index) {
    initialScore += 2;
  }
  return segments
    .filter(segment => segment !== '*')
    .reduce(
      (score, segment) =>
        score +
        (PARAM_SEGMENT_PATTERN.test(segment) ? 3 : segment === '' ? 1 : 10),
      initialScore,
    );
}

function compareIndexes(a, b) {
  const siblings =
    a.length === b.length && a.slice(0, -1).every((n, i) => n === b[i]);
  // Siblings keep their declaration order; other branches rank equally.
  return siblings ? a[a.length - 1] - b[b.length - 1] : 0;
}

function compilePath(path, caseSensitive = false, end = true) {
  const params = [];
  let regexpSource = `^${path
    .replace(/\/*\*?$/, '')
    .replace(/^\/*/, '/')
    .replace(/[\\.*+^${}|()[\]]/g, '\\$&')
    .replace(
      /\/:([\w-]+)(\?)?/g,
      (match, paramName, isOptional, index, str) => {
        params.push({ paramName, isOptional: isOptional != null });
        if (isOptional) {
          const nextChar = str.charAt(index + match.length);
          if (nextChar && nextChar !== '/') {
            return '/([^\\/]*)';
          }
          return '(?:/([^\\/]*))?';
        }
        return '/([^\\/]+)';
      },
    )
    .replace(/\/([\w-]+)\?(\/|$)/g, '(/$1)?$2')}`;
  if (path.endsWith('*')) {
    params.push({ paramName: '*' });
    regexpSource +=
      path === '*' || path === '/*' ? '(.*)$' : '(?:\\/(.+)|\\/*)$';
  } else if (end) {
    regexpSource += '\\/*$';
  } else if (path !== '' && path !== '/') {
    regexpSource += '(?:(?=\\/|$))';
  }
  return {
    matcher: new RegExp(regexpSource, caseSensitive ? undefined : 'i'),
    compiledParams: params,
  };
}

function flattenRoutes(
  routes,
  branches = [],
  parentsMeta = [],
  parentPath = '',
  parentHasOptionalSegments = false,
) {
  const flattenRoute = (
    route,
    childrenIndex,
    hasOptionalSegments = parentHasOptionalSegments,
    relativePath = undefined,
  ) => {
    const meta = {
      relativePath:
        relativePath === undefined ? route.path || '' : relativePath,
      caseSensitive: route.caseSensitive === true,
      childrenIndex,
      route,
    };
    if (meta.relativePath.startsWith('/')) {
      if (!meta.relativePath.startsWith(parentPath) && hasOptionalSegments) {
        return;
      }
      invariant(
        meta.relativePath.startsWith(parentPath),
        `Absolute route path "${meta.relativePath}" nested under path "${parentPath}" is not valid. An absolute child route path must start with the combined path of all its parent routes.`,
      );
      meta.relativePath = meta.relativePath.slice(parentPath.length);
    }
    const path = joinPaths([parentPath, meta.relativePath]);
    const routesMeta = parentsMeta.concat(meta);
    if (route.children && route.children.length > 0) {
      flattenRoutes(
        route.children,
        branches,
        routesMeta,
        path,
        hasOptionalSegments,
      );
    }
    if (route.path == null && !route.index) {
      return;
    }
    branches.push({
      path,
      score: computeScore(path, route.index),
      routesMeta: routesMeta.map((routeMeta, i) => ({
        ...routeMeta,
        ...compilePath(
          routeMeta.relativePath,
          routeMeta.caseSensitive,
          i === routesMeta.length - 1,
        ),
      })),
    });
  };
  routes.forEach((route, childrenIndex) => {
    if (route.path === '' || !route.path?.includes('?')) {
      flattenRoute(route, childrenIndex);
    } else {
      for (const exploded of explodeOptionalSegments(route.path)) {
        flattenRoute(route, childrenIndex, true, exploded);
      }
    }
  });
  return branches;
}

function flattenAndRankRoutes(routes) {
  return flattenRoutes(routes).sort((a, b) =>
    a.score !== b.score
      ? b.score - a.score
      : compareIndexes(
          a.routesMeta.map(meta => meta.childrenIndex),
          b.routesMeta.map(meta => meta.childrenIndex),
        ),
  );
}

function matchPathImpl(pathname, matcher, compiledParams) {
  const match = pathname.match(matcher);
  if (!match) {
    return null;
  }
  const matchedPathname = match[0];
  let pathnameBase = removeTrailingSlash(matchedPathname, 1);
  const captureGroups = match.slice(1);
  const params = compiledParams.reduce(
    (memo, { paramName, isOptional }, index) => {
      if (paramName === '*') {
        const splatValue = captureGroups[index] || '';
        pathnameBase = removeTrailingSlash(
          matchedPathname.slice(0, matchedPathname.length - splatValue.length),
          1,
        );
      }
      const value = captureGroups[index];
      memo[paramName] =
        isOptional && !value ? undefined : (value || '').replace(/%2F/g, '/');
      return memo;
    },
    {},
  );
  return { params, pathname: matchedPathname, pathnameBase };
}

function matchRouteBranch(branch, pathname) {
  // Every match of a branch shares the params of the whole branch.
  const matchedParams = {};
  let matchedPathname = '/';
  const matches = [];
  for (const meta of branch.routesMeta) {
    const remainingPathname =
      matchedPathname === '/'
        ? pathname
        : pathname.slice(matchedPathname.length) || '/';
    const match = matchPathImpl(
      remainingPathname,
      meta.matcher,
      meta.compiledParams,
    );
    if (!match) {
      return null;
    }
    Object.assign(matchedParams, match.params);
    matches.push({
      params: matchedParams,
      pathname: joinPaths([matchedPathname, match.pathname]),
      pathnameBase: normalizePathname(
        joinPaths([matchedPathname, match.pathnameBase]),
      ),
      route: meta.route,
    });
    if (match.pathnameBase !== '/') {
      matchedPathname = joinPaths([matchedPathname, match.pathnameBase]);
    }
  }
  return matches;
}

function decodePath(value) {
  try {
    return value
      .split('/')
      .map(segment => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/');
  } catch {
    return value;
  }
}

function stripBasename(pathname, basename) {
  if (basename === '/') {
    return pathname;
  }
  if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) {
    return null;
  }
  const startIndex = basename.endsWith('/')
    ? basename.length - 1
    : basename.length;
  const nextChar = pathname.charAt(startIndex);
  if (nextChar && nextChar !== '/') {
    return null;
  }
  return pathname.slice(startIndex) || '/';
}

function matchRoutes(branches, pathname, basename) {
  const strippedPathname = stripBasename(pathname || '/', basename);
  if (strippedPathname == null) {
    return null;
  }
  const decodedPathname = decodePath(strippedPathname);
  for (const branch of branches) {
    const matches = matchRouteBranch(branch, decodedPathname);
    if (matches) {
      return matches;
    }
  }
  return null;
}

// --- Route requests (react-router createStaticHandler().queryRoute) -------

class ErrorResponseImpl {
  constructor(status, statusText, data, internal = false) {
    this.status = status;
    this.statusText = statusText || '';
    this.internal = internal;
    if (data instanceof Error) {
      this.data = data.toString();
      this.error = data;
    } else {
      this.data = data;
    }
  }
}

function isRouteErrorResponse(error) {
  return (
    error != null &&
    typeof error.status === 'number' &&
    typeof error.statusText === 'string' &&
    typeof error.internal === 'boolean' &&
    'data' in error
  );
}

function getInternalRouterError(status, { pathname, routeId, method } = {}) {
  let statusText = 'Unknown Server Error';
  let errorMessage = 'Unknown @remix-run/router error';
  if (status === 403) {
    statusText = 'Forbidden';
    errorMessage = `Route "${routeId}" does not match URL "${pathname}"`;
  } else if (status === 404) {
    statusText = 'Not Found';
    errorMessage = `No route matches URL "${pathname}"`;
  } else if (status === 405) {
    statusText = 'Method Not Allowed';
    if (method && pathname && routeId) {
      errorMessage = `You made a ${method.toUpperCase()} request to "${pathname}" but did not provide an \`action\` for route "${routeId}", so there is no way to handle the request.`;
    } else if (method) {
      errorMessage = `Invalid request method "${method.toUpperCase()}"`;
    }
  }
  return new ErrorResponseImpl(
    status || 500,
    statusText,
    new Error(errorMessage),
    true,
  );
}

function isResponse(value) {
  return (
    value != null &&
    typeof value.status === 'number' &&
    typeof value.statusText === 'string' &&
    typeof value.headers === 'object' &&
    typeof value.body !== 'undefined'
  );
}

const isRedirectStatus = status => REDIRECT_STATUS_CODES.has(status);

function isRouterRedirectResponse(value) {
  return (
    isResponse(value) &&
    isRedirectStatus(value.status) &&
    value.headers.has('Location')
  );
}

function isDataWithResponseInit(value) {
  return (
    typeof value === 'object' &&
    value != null &&
    'type' in value &&
    'data' in value &&
    'init' in value &&
    value.type === 'DataWithResponseInit'
  );
}

function isHandlerResult(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    'type' in value &&
    'result' in value &&
    (value.type === 'data' || value.type === 'error')
  );
}

function parsePath(path) {
  const parsedPath = {};
  if (path) {
    let rest = path;
    const hashIndex = rest.indexOf('#');
    if (hashIndex >= 0) {
      parsedPath.hash = rest.substring(hashIndex);
      rest = rest.substring(0, hashIndex);
    }
    const searchIndex = rest.indexOf('?');
    if (searchIndex >= 0) {
      parsedPath.search = rest.substring(searchIndex);
      rest = rest.substring(0, searchIndex);
    }
    if (rest) {
      parsedPath.pathname = rest;
    }
  }
  return parsedPath;
}

function createPath({ pathname = '/', search = '', hash = '' }) {
  let path = pathname;
  if (search && search !== '?') {
    path += search.charAt(0) === '?' ? search : `?${search}`;
  }
  if (hash && hash !== '#') {
    path += hash.charAt(0) === '#' ? hash : `#${hash}`;
  }
  return path;
}

function resolvePathname(relativePath, fromPathname) {
  const segments = removeTrailingSlash(fromPathname).split('/');
  for (const segment of relativePath.split('/')) {
    if (segment === '..') {
      if (segments.length > 1) {
        segments.pop();
      }
    } else if (segment !== '.') {
      segments.push(segment);
    }
  }
  return segments.length > 1 ? segments.join('/') : '/';
}

const normalizeSearch = search =>
  !search || search === '?'
    ? ''
    : search.startsWith('?')
      ? search
      : `?${search}`;
const normalizeHash = hash =>
  !hash || hash === '#' ? '' : hash.startsWith('#') ? hash : `#${hash}`;

function resolvePath(to, fromPathname = '/') {
  const { pathname: toPathname, search = '', hash = '' } = to;
  let pathname = fromPathname;
  if (toPathname) {
    const normalizedPathname = removeDoubleSlashes(toPathname);
    pathname =
      normalizedPathname.startsWith('/') || normalizedPathname.startsWith('\\')
        ? resolvePathname(normalizedPathname.substring(1), '/')
        : resolvePathname(normalizedPathname, fromPathname);
  }
  return {
    pathname,
    search: normalizeSearch(search),
    hash: normalizeHash(hash),
  };
}

function resolveTo(toArg, routePathnames, locationPathname) {
  const to = parsePath(toArg);
  const isEmptyPath = toArg === '' || to.pathname === '';
  const toPathname = isEmptyPath ? '/' : to.pathname;
  let from;
  if (toPathname == null) {
    from = locationPathname;
  } else {
    let routePathnameIndex = routePathnames.length - 1;
    if (toPathname.startsWith('..')) {
      const toSegments = toPathname.split('/');
      while (toSegments[0] === '..') {
        toSegments.shift();
        routePathnameIndex -= 1;
      }
      to.pathname = toSegments.join('/');
    }
    from = routePathnameIndex >= 0 ? routePathnames[routePathnameIndex] : '/';
  }
  const path = resolvePath(to, from);
  const hasExplicitTrailingSlash =
    toPathname && toPathname !== '/' && toPathname.endsWith('/');
  const hasCurrentTrailingSlash =
    (isEmptyPath || toPathname === '.') && locationPathname.endsWith('/');
  if (
    !path.pathname.endsWith('/') &&
    (hasExplicitTrailingSlash || hasCurrentTrailingSlash)
  ) {
    path.pathname += '/';
  }
  return path;
}

const hasNakedIndexQuery = search =>
  new URLSearchParams(search).getAll('index').some(value => value === '');

/** Resolve a relative redirect `Location` against the matched route. */
function normalizeRedirectLocation(requestUrl, matches, basename, to) {
  const pathMatches = matches.filter(
    (match, index) =>
      index === 0 || (match.route.path && match.route.path.length > 0),
  );
  const routePathnames = pathMatches.map((match, index) =>
    index === pathMatches.length - 1 ? match.pathname : match.pathnameBase,
  );
  const activeRouteMatch = matches[matches.length - 1];
  const path = resolveTo(
    to,
    routePathnames,
    stripBasename(requestUrl.pathname, basename) || requestUrl.pathname,
  );
  if (to === '.' && activeRouteMatch) {
    const nakedIndex = hasNakedIndexQuery(path.search);
    if (activeRouteMatch.route.index && !nakedIndex) {
      path.search = path.search
        ? path.search.replace(/^\?/, '?index&')
        : '?index';
    } else if (!activeRouteMatch.route.index && nakedIndex) {
      const params = new URLSearchParams(path.search);
      const indexValues = params.getAll('index');
      params.delete('index');
      for (const value of indexValues.filter(Boolean)) {
        params.append('index', value);
      }
      const qs = params.toString();
      path.search = qs ? `?${qs}` : '';
    }
  }
  if (basename !== '/') {
    path.pathname =
      path.pathname === '/' ? basename : joinPaths([basename, path.pathname]);
  }
  return createPath(path);
}

function normalizeRelativeRedirectResponse(
  response,
  request,
  routeId,
  matches,
  basename,
) {
  const location = response.headers.get('Location');
  invariant(
    location,
    'Redirects returned/thrown from loaders/actions must have a Location header',
  );
  if (!ABSOLUTE_URL_PATTERN.test(location)) {
    response.headers.set(
      'Location',
      normalizeRedirectLocation(
        new URL(request.url),
        matches.slice(0, matches.findIndex(m => m.route.id === routeId) + 1),
        basename,
        location,
      ),
    );
  }
  return response;
}

function createDataFunctionUrl(request, location) {
  const url = new URL(request.url);
  url.pathname = location.pathname || '/';
  if (location.search) {
    const searchParams = new URLSearchParams(location.search);
    const indexValues = searchParams.getAll('index');
    searchParams.delete('index');
    for (const value of indexValues.filter(Boolean)) {
      searchParams.append('index', value);
    }
    url.search = searchParams.size ? `?${searchParams.toString()}` : '';
  } else {
    url.search = '';
  }
  url.hash = location.hash || '';
  return url;
}

function throwAbortedError(request) {
  if (request.signal.reason !== undefined) {
    throw request.signal.reason;
  }
  throw new Error(
    `queryRoute() call aborted without an \`AbortSignal.reason\`: ${request.method} ${request.url}`,
  );
}

/**
 * Run a route loader or action, settling as a `{ type, result }` handler
 * result. An aborted request settles it as an error without a value.
 */
async function callRouteHandler(handler, args, request, match, isAction) {
  let onAbort;
  try {
    const abortPromise = new Promise((_, reject) => {
      onAbort = () => reject();
    });
    request.signal.addEventListener('abort', onAbort);
    const handlerPromise = (async () => {
      try {
        if (typeof handler !== 'function') {
          throw new Error(
            `You cannot call the handler for a route which defines a boolean "${
              isAction ? 'action' : 'loader'
            }" [routeId: ${match.route.id}]`,
          );
        }
        return { type: 'data', result: await handler(args) };
      } catch (error) {
        return { type: 'error', result: error };
      }
    })();
    return await Promise.race([handlerPromise, abortPromise]);
  } catch (error) {
    return { type: 'error', result: error };
  } finally {
    if (onAbort) {
      request.signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Settle a route request like react-router's static handler `queryRoute()`.
 * Resolves with the loader or action value, or with a Response that the
 * route returned or that redirects; rejects with what the route threw.
 */
async function queryRoute(request, { branches, basename, routeId, context }) {
  const { method } = request;
  const url = new URL(request.url);
  const location = {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
  const matches = matchRoutes(branches, location.pathname, basename);
  if (
    !REQUEST_METHODS.has(method.toUpperCase()) &&
    method !== 'HEAD' &&
    method !== 'OPTIONS'
  ) {
    throw getInternalRouterError(405, { method });
  }
  if (!matches) {
    throw getInternalRouterError(404, { pathname: location.pathname });
  }
  const match = matches.find(m => m.route.id === routeId);
  if (!match) {
    throw getInternalRouterError(403, {
      pathname: location.pathname,
      routeId,
    });
  }

  const isAction = MUTATION_METHODS.has(method.toUpperCase());
  let result;
  try {
    const { loaderRoute } = match.route;
    if (isAction && !loaderRoute.action) {
      throw getInternalRouterError(405, {
        method,
        pathname: url.pathname,
        routeId: match.route.id,
      });
    }
    const handlerResult = await callRouteHandler(
      isAction
        ? loaderRoute.action
        : args => context.loadRoute(loaderRoute, args),
      {
        request,
        url: createDataFunctionUrl(request, location),
        pattern:
          joinPaths(matches.map(m => m.route.path).filter(Boolean)) || '/',
        params: match.params,
        context: context.requestContext,
      },
      request,
      match,
      isAction,
    );
    const value = handlerResult.result;
    if (isResponse(value) && isRedirectStatus(value.status)) {
      throw normalizeRelativeRedirectResponse(
        value,
        request,
        match.route.id,
        matches,
        basename,
      );
    }
    if (isResponse(value)) {
      throw handlerResult;
    }
    if (isDataWithResponseInit(value)) {
      throw Response.json(value.data, value.init ?? undefined);
    }
    if (request.signal.aborted) {
      throwAbortedError(request);
    }
    if (isAction && handlerResult.type === 'error') {
      throw value;
    }
    result = handlerResult;
  } catch (error) {
    if (isHandlerResult(error) && isResponse(error.result)) {
      if (error.type === 'error') {
        throw error.result;
      }
      return error.result;
    }
    if (isRouterRedirectResponse(error)) {
      return error;
    }
    throw error;
  }
  // A loader that threw `undefined` has no error to report and no data.
  if (result.type === 'error' && result.result !== undefined) {
    throw result.result;
  }
  return result.type === 'error' ? undefined : result.result;
}

// --- Response encoding (@modern-js/plugin-data-loader/runtime) ------------

const isProductionErrorMode = () =>
  process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test';

function serializeError(error) {
  const sanitized =
    error instanceof Error && isProductionErrorMode()
      ? Object.assign(new Error('Unexpected Server Error'), {
          stack: undefined,
        })
      : error;
  return { message: sanitized.message, stack: sanitized.stack };
}

function errorResponseToJson(errorResponse) {
  return Response.json(
    serializeError(errorResponse.error || new Error('Unexpected Server Error')),
    {
      status: errorResponse.status,
      statusText:
        errorResponse.status >= 500 && isProductionErrorMode()
          ? 'Internal Server Error'
          : errorResponse.statusText,
      headers: { 'X-Modernjs-Error': 'yes' },
    },
  );
}

function convertModernRedirectResponse(headers, basename) {
  const newHeaders = new Headers(headers);
  let redirectUrl = headers.get('Location');
  // The client loader handles the basename.
  if (basename !== '/') {
    redirectUrl = redirectUrl.replace(basename, '');
  }
  newHeaders.set('X-Modernjs-Redirect', redirectUrl);
  newHeaders.delete('Location');
  return new Response(null, { status: 204, headers: newHeaders });
}

function serializeDeferredError(error) {
  return isProductionErrorMode()
    ? { message: 'Unexpected Server Error', stack: undefined }
    : { message: error.message, stack: error.stack };
}

function isTrackedPromise(value) {
  return (
    value != null && typeof value.then === 'function' && value._tracked === true
  );
}

function enqueueTrackedPromise(controller, encoder, settledKey, promise) {
  if ('_error' in promise) {
    controller.enqueue(
      encoder.encode(
        `error:${serializeJson({
          [settledKey]: serializeDeferredError(promise._error),
        })}\n\n`,
      ),
    );
  } else {
    controller.enqueue(
      encoder.encode(
        `data:${JSON.stringify({ [settledKey]: promise._data ?? null })}\n\n`,
      ),
    );
  }
}

function createDeferredReadableStream(deferredData, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const criticalData = {};
      const preresolvedKeys = [];
      for (const [key, value] of Object.entries(deferredData.data)) {
        if (isTrackedPromise(value)) {
          criticalData[key] = `${DEFERRED_VALUE_PLACEHOLDER_PREFIX}${key}`;
          if (
            typeof value._data !== 'undefined' ||
            typeof value._error !== 'undefined'
          ) {
            preresolvedKeys.push(key);
          }
        } else {
          criticalData[key] = value;
        }
      }
      controller.enqueue(encoder.encode(`${JSON.stringify(criticalData)}\n\n`));
      for (const preresolvedKey of preresolvedKeys) {
        enqueueTrackedPromise(
          controller,
          encoder,
          preresolvedKey,
          deferredData.data[preresolvedKey],
        );
      }
      const unsubscribe = deferredData.subscribe((_aborted, settledKey) => {
        if (settledKey) {
          enqueueTrackedPromise(
            controller,
            encoder,
            settledKey,
            deferredData.data[settledKey],
          );
        }
      });
      await deferredData.resolveData(signal);
      unsubscribe();
      controller.close();
    },
  });
}

const isObjectLiteral = value =>
  value != null &&
  typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype;

function hasFileExtension(pathname) {
  const lastSegment = pathname.split('/').pop() || '';
  const dotIndex = lastSegment.lastIndexOf('.');
  return (
    dotIndex !== -1 && lastSegment.substring(dotIndex).toLowerCase() !== '.html'
  );
}

const matchEntry = (pathname, serverRoutes) =>
  [...serverRoutes]
    .sort((a, b) => b.urlPath.length - a.urlPath.length)
    .find(entry => pathname.startsWith(entry.urlPath));

/**
 * Create the worker route data request handler for an entry's route loaders
 * (the `routes` export of its generated `route-server-loaders.js`).
 *
 * The handler takes the Node data handler's options and resolves to
 * `undefined` for requests that are not route data requests of a known entry,
 * so the caller renders the page instead.
 */
export function createRouteDataRequestHandler(routes) {
  let routeTable;
  const getRouteTable = () => {
    if (!routeTable) {
      const loaderRoutes = expandLocalisedLoaderRoutes(routes);
      invariant(
        loaderRoutes.length > 0,
        'You must provide a non-empty routes array to createStaticHandler',
      );
      routeTable = {
        loaderRoutes,
        branches: flattenAndRankRoutes(createRouteTree(loaderRoutes)),
      };
    }
    return routeTable;
  };

  return async ({ request, serverRoutes, context = {}, onTiming }) => {
    const url = new URL(request.url);
    const requestedRouteId = url.searchParams.get(LOADER_ID_PARAM);
    if (hasFileExtension(url.pathname)) {
      return undefined;
    }
    const entry = matchEntry(url.pathname, serverRoutes);
    if (!requestedRouteId || !entry) {
      return undefined;
    }

    const basename = entry.urlPath;
    const end = time();
    const { reporter, loaderContext, monitors } = context;
    const activeDeferreds = new Map();

    return storage.run(
      {
        headers: parseHeaders(request),
        monitors,
        request,
        activeDeferreds,
      },
      async () => {
        const { loaderRoutes, branches } = getRouteTable();
        const routeId = resolveLocalisedLoaderRoute(requestedRouteId, {
          routes: loaderRoutes,
          matchedRouteIds:
            matchRoutes(branches, url.pathname, basename)?.map(
              match => match.route.id,
            ) ?? [],
        });
        const requestContext = createRequestContext(loaderContext);
        requestContext.set(reporterCtx, reporter);

        // Route loaders run like the data loader runtime's nested route
        // loaders: plain object data is served as deferred data.
        const loadRoute = async (loaderRoute, args) => {
          if (!loaderRoute.loader) {
            return null;
          }
          const endLoader = time();
          const data = await loaderRoute.loader(args);
          if (isObjectLiteral(data)) {
            activeDeferreds.set(loaderRoute.id, new DeferredData(data));
          }
          monitors?.timing(
            `${LOADER_REPORTER_NAME}-${loaderRoute.id?.replace(/\//g, '_')}`,
            endLoader(),
          );
          return data;
        };

        let response;
        try {
          response = await queryRoute(request, {
            basename: basename || '/',
            branches,
            context: { loadRoute, requestContext },
            routeId,
          });
          // Only a loader's object literal data is registered as deferred
          // data, and it is the value the route request resolved with.
          const deferredData = activeDeferreds.get(routeId);
          if (isResponse(response) && isRedirectStatus(response.status)) {
            response = convertModernRedirectResponse(
              response.headers,
              basename,
            );
          } else if (deferredData) {
            response = new Response(
              createDeferredReadableStream(deferredData, request.signal),
              {
                headers: {
                  'Content-Type': `${CONTENT_TYPE_DEFERRED}; charset=UTF-8`,
                },
              },
            );
          } else if (!isResponse(response)) {
            response = new Response(JSON.stringify(response), {
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            });
          }
          const cost = end();
          // Tells the client the response comes from the Modern.js server.
          response.headers.set('X-Modernjs-Response', 'yes');
          onTiming?.(`${LOADER_REPORTER_NAME}-navigation`, cost);
        } catch (error) {
          if (isResponse(error)) {
            error.headers.set('X-Modernjs-Catch', 'yes');
            response = error;
          } else if (isRouteErrorResponse(error)) {
            response = errorResponseToJson(error);
          } else {
            const errorInstance =
              error instanceof Error || error instanceof DOMException
                ? error
                : new Error('Unexpected Server Error');
            response = new Response(
              JSON.stringify(serializeError(errorInstance)),
              {
                status: 500,
                headers: {
                  'X-Modernjs-Error': 'yes',
                  'Content-Type': 'application/json',
                },
              },
            );
          }
        }
        return response;
      },
    );
  };
}
