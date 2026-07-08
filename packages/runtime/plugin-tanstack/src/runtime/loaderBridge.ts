// @effect-diagnostics strictBooleanExpressions:off
/**
 * Runtime bridge between Modern.js data loaders and TanStack Router.
 *
 * The generated `src/modern-tanstack/<entry>/router.gen.ts` files import these
 * helpers instead of inlining them, so loader/redirect bugfixes ship with the
 * package instead of requiring every app to regenerate its files. The
 * hand-written route-tree builder (`routeTree.ts`) shares the response/redirect
 * helpers for the same reason.
 */
import { notFound, redirect } from '@tanstack/react-router';

/** Router context shape used by the generated TanStack router types. */
export type ModernRouterContext = {
  request?: Request;
  requestContext?: unknown;
};

export function isResponse(value: unknown): value is Response {
  const record = value as { headers?: unknown; status?: unknown } | null;
  return (
    record != null &&
    typeof record === 'object' &&
    typeof record.status === 'number' &&
    typeof record.headers === 'object'
  );
}

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

export function isRedirectResponse(res: Response): boolean {
  return redirectStatusCodes.has(res.status);
}

/**
 * TanStack redirects are Response objects carrying the original redirect
 * `options`. They must be re-thrown untouched — re-translating them through
 * the Modern Response handling would lose `to`-based (internal) targets.
 */
export function isTanstackRedirect(value: unknown): boolean {
  return (
    isResponse(value) &&
    typeof (value as { options?: unknown }).options === 'object'
  );
}

export function isAbsoluteUrl(value: string): boolean {
  try {
    void new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-throw a Modern.js `Location` redirect as a TanStack redirect.
 *
 * Prefers `to` for internal/relative redirects so the basepath rewrite can be
 * applied; absolute (external) URLs go through `href` untouched.
 */
export function throwTanstackRedirect(location: string): never {
  const target = location || '/';
  if (isAbsoluteUrl(target)) {
    throw redirect({ href: target });
  }

  throw redirect({ to: target });
}

/**
 * React Router uses `*` for splat params, TanStack Router uses `_splat`.
 * Modern loaders expect the React Router spelling.
 */
export function mapSplatParamsForModernLoader(
  params: Record<string, string>,
  hasSplat: boolean,
): Record<string, string> {
  if (!hasSplat) {
    return params;
  }

  const { _splat, ...rest } = params as Record<string, string> & {
    _splat?: string;
  };
  if (typeof _splat !== 'undefined') {
    return { ...rest, '*': _splat };
  }
  return rest;
}

/**
 * Static-data factory used by the generated router files: drops empty fields
 * so route static data stays minimal.
 */
export function createRouteStaticData(opts: {
  modernRouteId?: string;
  modernRouteAction?: unknown;
  modernRouteLoader?: unknown;
}): {
  modernRouteId?: string;
  modernRouteAction?: unknown;
  modernRouteLoader?: unknown;
} {
  const staticData: {
    modernRouteId?: string;
    modernRouteAction?: unknown;
    modernRouteLoader?: unknown;
  } = {};

  if (typeof opts.modernRouteId === 'string' && opts.modernRouteId.length > 0) {
    staticData.modernRouteId = opts.modernRouteId;
  }

  if (typeof opts.modernRouteLoader !== 'undefined') {
    staticData.modernRouteLoader = opts.modernRouteLoader;
  }

  if (typeof opts.modernRouteAction !== 'undefined') {
    staticData.modernRouteAction = opts.modernRouteAction;
  }

  return staticData;
}

type LoaderLikeContext = {
  abortController?: AbortController;
  signal?: AbortSignal;
  context?: ModernRouterContext;
  location?:
    | string
    | {
        publicHref?: string;
        href?: string;
        url?: { href?: string };
      };
  params?: Record<string, string>;
};

function getLoaderSignal(ctx: LoaderLikeContext | undefined): AbortSignal {
  const abortSignal = ctx?.abortController?.signal;
  if (abortSignal instanceof AbortSignal) {
    return abortSignal;
  }
  if (ctx?.signal instanceof AbortSignal) {
    return ctx.signal;
  }
  return new AbortController().signal;
}

function getLoaderHref(ctx: LoaderLikeContext | undefined): string {
  if (typeof ctx?.location === 'string') {
    return ctx.location;
  }

  const publicHref = ctx?.location?.publicHref;
  if (typeof publicHref === 'string') {
    return publicHref;
  }

  const href = ctx?.location?.href;
  if (typeof href === 'string') {
    return href;
  }

  const urlHref = ctx?.location?.url?.href;
  return typeof urlHref === 'string' ? urlHref : '';
}

function getLoaderParams(
  ctx: LoaderLikeContext | undefined,
): Record<string, string> {
  return typeof ctx?.params === 'object' && ctx.params !== null
    ? ctx.params
    : {};
}

function handleModernLoaderResult<LoaderResult>(
  result: LoaderResult,
): LoaderResult {
  if (isResponse(result)) {
    if (isRedirectResponse(result)) {
      const location = result.headers.get('Location') ?? '/';
      throwTanstackRedirect(location);
    }
    if (result.status === 404) {
      throw notFound();
    }
  }

  return result;
}

function handleModernLoaderError(err: unknown): never {
  if (isResponse(err)) {
    if (isTanstackRedirect(err)) {
      throw err;
    }
    if (isRedirectResponse(err)) {
      const location = err.headers.get('Location') ?? '/';
      throwTanstackRedirect(location);
    }
    if (err.status === 404) {
      throw notFound();
    }
  }

  throw err;
}

/**
 * Wrap a Modern.js data loader (`page.data.ts` loader/action style) into a
 * TanStack Router loader: builds a `Request` from the loader context, maps
 * splat params, and translates Response redirects/404s into TanStack
 * `redirect()`/`notFound()`.
 */
export function modernLoaderToTanstack<TLoader extends (args: any) => any>(
  opts: { hasSplat: boolean },
  modernLoader: TLoader,
): (ctx: unknown) => Promise<Awaited<ReturnType<TLoader>>> {
  type LoaderResult = Awaited<ReturnType<TLoader>>;

  return (rawCtx: unknown): Promise<LoaderResult> => {
    const ctx = rawCtx as LoaderLikeContext | undefined;
    try {
      const signal = getLoaderSignal(ctx);
      const baseRequest: Request | undefined =
        ctx?.context?.request instanceof Request
          ? ctx.context.request
          : undefined;

      const href = getLoaderHref(ctx);

      const request =
        baseRequest !== undefined && href !== ''
          ? new Request(new URL(href, baseRequest.url).href, {
              headers: baseRequest.headers,
              signal,
            })
          : baseRequest !== undefined
            ? new Request(baseRequest, { signal })
            : new Request(href, { signal });

      const params = mapSplatParamsForModernLoader(
        getLoaderParams(ctx),
        opts.hasSplat,
      );

      return Promise.resolve(
        (modernLoader as (args: unknown) => unknown)({
          request,
          params,
          context: ctx?.context?.requestContext,
        }) as LoaderResult,
      )
        .then((result: LoaderResult) => handleModernLoaderResult(result))
        .catch(handleModernLoaderError);
    } catch (err) {
      handleModernLoaderError(err);
    }
  };
}
