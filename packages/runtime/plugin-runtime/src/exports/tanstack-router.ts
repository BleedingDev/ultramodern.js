/**
 * @deprecated Legacy alias kept so the published `@modern-js/runtime/tanstack-router`
 * subpath keeps resolving. Use `@modern-js/plugin-tanstack/runtime` instead.
 *
 * The Modern.js specific `Link`, `NavLink`, `Outlet`, `Form`, `useFetcher` and
 * `RouteActionResponseError` bindings are still exported from here for
 * compatibility, but they are thin delegates: the real implementations live in
 * `@modern-js/plugin-tanstack` and are looked up at use time through a
 * `Symbol.for` slot that '@modern-js/plugin-tanstack/runtime' populates on
 * import. (`@modern-js/runtime` cannot import `@modern-js/plugin-tanstack`
 * directly — the package dependency points the other way.)
 */
import type {
  AnyRouter,
  LinkComponentProps,
  RegisteredRouter,
} from '@tanstack/react-router';
import type React from 'react';
import { createElement } from 'react';

export type * from '@tanstack/react-router';
export {
  Asset,
  Await,
  Block,
  CatchBoundary,
  CatchNotFound,
  ClientOnly,
  cleanPath,
  composeRewrites,
  createBrowserHistory,
  createControlledPromise,
  createFileRoute,
  createHashHistory,
  createHistory,
  createLazyFileRoute,
  createLazyRoute,
  createLink,
  createMemoryHistory,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouteMask,
  createRouter,
  createRouterConfig,
  createSerializationAdapter,
  DEFAULT_PROTOCOL_ALLOWLIST,
  DefaultGlobalNotFound,
  deepEqual,
  defaultParseSearch,
  defaultStringifySearch,
  defer,
  ErrorComponent,
  FileRoute,
  FileRouteLoader,
  functionalUpdate,
  getRouteApi,
  HeadContent,
  interpolatePath,
  isMatch,
  isNotFound,
  isPlainArray,
  isPlainObject,
  isRedirect,
  joinPaths,
  LazyRoute,
  lazyFn,
  lazyRouteComponent,
  linkOptions,
  Match,
  Matches,
  MatchRoute,
  Navigate,
  NotFoundRoute,
  notFound,
  parseSearchWith,
  RootRoute,
  Route,
  RouteApi,
  Router,
  RouterContextProvider,
  RouterProvider,
  reactUse,
  redirect,
  replaceEqualDeep,
  resolvePath,
  retainSearchParams,
  rootRouteId,
  rootRouteWithContext,
  ScriptOnce,
  Scripts,
  ScrollRestoration,
  SearchParamError,
  stringifySearchWith,
  stripSearchParams,
  trimPath,
  trimPathLeft,
  trimPathRight,
  useAwaited,
  useBlocker,
  useCanGoBack,
  useChildMatches,
  useElementScrollRestoration,
  useHydrated,
  useLayoutEffect,
  useLinkProps,
  useLoaderData,
  useLoaderDeps,
  useLocation,
  useMatch,
  useMatches,
  useMatchRoute,
  useNavigate,
  useParams,
  useParentMatches,
  useRouteContext,
  useRouter,
  useRouterState,
  useSearch,
  useTags,
} from '@tanstack/react-router';

// ----------------------------------------------------------------------------
// Modern.js compatibility bindings (provided by @modern-js/plugin-tanstack).
// ----------------------------------------------------------------------------

export type PrefetchBehavior = 'intent' | 'render' | 'viewport' | 'none';

export type LinkProps<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends string = string,
  TTo extends string | undefined = '.',
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = '.',
> = LinkComponentProps<'a', TRouter, TFrom, TTo, TMaskFrom, TMaskTo> & {
  prefetch?: PrefetchBehavior;
};

export type NavLinkProps<
  TRouter extends AnyRouter = RegisteredRouter,
  TFrom extends string = string,
  TTo extends string | undefined = '.',
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = '.',
> = LinkProps<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

type LinkComponent = <
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = '',
>(
  props: LinkProps<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
) => React.ReactElement;

export type SubmitOptions = {
  action?: string;
  method?: string;
  encType?: string;
};

export type FetcherState = 'idle' | 'submitting' | 'loading';

export type FetcherSubmitOptions = SubmitOptions;

export type FormProps = Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  'onSubmit' | 'action'
> & {
  action?: string;
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  reloadDocument?: boolean;
};

type SubmitTarget =
  | HTMLFormElement
  | FormData
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined>;

export type Fetcher = {
  state: FetcherState;
  data: unknown;
  error: unknown;
  Form: React.ComponentType<FormProps>;
  submit: (
    target: SubmitTarget,
    options?: FetcherSubmitOptions,
  ) => Promise<void>;
};

export interface RouteActionResponseError<TData = unknown> extends Error {
  readonly response: Response;
  readonly data: TData;
}

interface RouteActionResponseErrorConstructor {
  new <TData = unknown>(
    response: Response,
    data: TData,
  ): RouteActionResponseError<TData>;
  readonly prototype: RouteActionResponseError<unknown>;
}

type TanstackRouterCompatBindings = {
  Form: React.ComponentType<FormProps>;
  Link: LinkComponent;
  NavLink: LinkComponent;
  Outlet: React.ComponentType;
  RouteActionResponseError: RouteActionResponseErrorConstructor;
  useFetcher: () => Fetcher;
};

/**
 * Populated by the import side effect of '@modern-js/plugin-tanstack/runtime'
 * (see its `register.ts`). `Symbol.for` keeps the slot coherent across
 * esm/cjs duplicates and Module Federation copies.
 */
const COMPAT_BINDINGS_SLOT: unique symbol = Symbol.for(
  '@modern-js/plugin-tanstack:runtime-compat-bindings',
);

function readCompatBindings(): TanstackRouterCompatBindings | undefined {
  return (
    globalThis as { [COMPAT_BINDINGS_SLOT]?: TanstackRouterCompatBindings }
  )[COMPAT_BINDINGS_SLOT];
}

function resolveCompatBindings(
  exportName: string,
): TanstackRouterCompatBindings {
  const bindings = readCompatBindings();
  if (bindings === undefined) {
    throw new Error(
      `[@modern-js/runtime] '${exportName}' from the deprecated '@modern-js/runtime/tanstack-router' alias is provided by @modern-js/plugin-tanstack. ` +
        'Install @modern-js/plugin-tanstack, add `tanstackRouterPlugin()` to the `plugins` array in modern.config.ts, and make sure ' +
        `'@modern-js/plugin-tanstack/runtime' is imported (e.g. in modern.runtime.ts) before '${exportName}' is used. ` +
        `Prefer importing '${exportName}' from '@modern-js/plugin-tanstack/runtime' directly.`,
    );
  }
  return bindings;
}

/**
 * @deprecated Import `Link` from `@modern-js/plugin-tanstack/runtime` instead.
 */
export const Link: LinkComponent = ((props: Record<string, unknown>) =>
  createElement(
    resolveCompatBindings('Link').Link as React.ComponentType<
      Record<string, unknown>
    >,
    props,
  )) as LinkComponent;

/**
 * @deprecated Import `NavLink` from `@modern-js/plugin-tanstack/runtime` instead.
 */
export const NavLink: LinkComponent = ((props: Record<string, unknown>) =>
  createElement(
    resolveCompatBindings('NavLink').NavLink as React.ComponentType<
      Record<string, unknown>
    >,
    props,
  )) as LinkComponent;

/**
 * @deprecated Import `Outlet` from `@modern-js/plugin-tanstack/runtime` instead.
 */
export const Outlet: React.ComponentType = () =>
  createElement(resolveCompatBindings('Outlet').Outlet);

/**
 * @deprecated Import `Form` from `@modern-js/plugin-tanstack/runtime` instead.
 */
export const Form: React.ComponentType<FormProps> = props =>
  createElement(resolveCompatBindings('Form').Form, props);

/**
 * @deprecated Import `useFetcher` from `@modern-js/plugin-tanstack/runtime`
 * instead.
 */
export function useFetcher(): Fetcher {
  return resolveCompatBindings('useFetcher').useFetcher();
}

// The proxy target is a plain function (not a class) on purpose: a class's
// `prototype` property is non-writable, which would make the `get` trap
// violate proxy invariants when forwarding `prototype` to the real class.
function RouteActionResponseErrorPlaceholder() {
  // Construction always goes through the proxy `construct` trap.
}

/**
 * @deprecated Import `RouteActionResponseError` from
 * `@modern-js/plugin-tanstack/runtime` instead.
 *
 * Delegates to the real class registered by '@modern-js/plugin-tanstack/runtime'
 * so that `instanceof` checks observe the same class identity. Before the
 * registration happens no instance can exist, so `instanceof` is gracefully
 * `false`; constructing without @modern-js/plugin-tanstack installed throws an
 * actionable error.
 */
export const RouteActionResponseError: RouteActionResponseErrorConstructor =
  new Proxy(
    RouteActionResponseErrorPlaceholder as unknown as RouteActionResponseErrorConstructor,
    {
      construct(_target, args) {
        const RealError = resolveCompatBindings(
          'RouteActionResponseError',
        ).RouteActionResponseError;
        return new RealError(...(args as [Response, unknown]));
      },
      get(target, property, receiver) {
        const RealError = readCompatBindings()?.RouteActionResponseError;
        if (RealError !== undefined) {
          return Reflect.get(RealError, property);
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );
