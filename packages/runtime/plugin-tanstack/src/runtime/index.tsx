export * from '@tanstack/react-router';
export { useMatch } from '@tanstack/react-router';
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
