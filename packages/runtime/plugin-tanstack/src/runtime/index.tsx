import './register';

export * from '@tanstack/react-router';
export type {
  Fetcher,
  FetcherState,
  FetcherSubmitOptions,
  FormProps,
  SubmitOptions,
} from './dataMutation';
export {
  Form,
  RouteActionResponseError,
  useFetcher,
} from './dataMutation';
export type { ModernRouterContext } from './loaderBridge';
export {
  createRouteStaticData,
  isAbsoluteUrl,
  modernLoaderToTanstack,
  throwTanstackRedirect,
} from './loaderBridge';
export { Outlet } from './outlet';
export {
  tanstackRouterPlugin,
  tanstackRouterPlugin as default,
} from './plugin';
export type {
  LinkProps,
  NavLinkProps,
  PrefetchBehavior,
} from './prefetchLink';
export { Link, NavLink } from './prefetchLink';
export type { TanstackRouterState } from './state';
export { getTanstackRouterState } from './state';
export type { RouterConfig } from './types';
export {
  getModernTanstackRouterFastDefaults,
  modernTanstackRouterFastDefaults,
} from './types';
