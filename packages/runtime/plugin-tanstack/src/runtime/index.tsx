export * from '@tanstack/react-router';
export {
  Outlet,
  useLocation,
  useMatch,
  useMatches,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
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
export type {
  AnyCompositeComponent,
  AnyRenderableServerComponent,
  CompositeComponentProps,
} from './rsc/client';
export { CompositeComponent } from './rsc/client';
export type { RouterConfig } from './types';
export {
  getModernTanstackRouterFastDefaults,
  modernTanstackRouterFastDefaults,
} from './types';
