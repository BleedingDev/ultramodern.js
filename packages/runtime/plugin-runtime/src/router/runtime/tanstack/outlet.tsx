import { Outlet as TanstackOutlet } from '@tanstack/react-router';
import {
  createElement,
  type ElementType,
  memo,
  type ReactElement,
} from 'react';

type RouteComponentProps = Record<string, unknown>;
type PreloadableComponent = ElementType<RouteComponentProps> & {
  load?: () => Promise<unknown>;
  preload?: () => Promise<unknown>;
};
type WrappedPreloadableComponent = ((
  props: RouteComponentProps,
) => ReactElement | null) & {
  load?: () => Promise<unknown>;
  preload?: () => Promise<unknown>;
};

export const Outlet = memo(function ModernTanstackOutlet() {
  return <TanstackOutlet />;
});

export function withModernRouteMatchContext(
  component: unknown,
  _routeId: string,
): unknown {
  if (component === null || component === undefined) {
    return component;
  }

  const Component = component as ElementType<RouteComponentProps>;
  const WrappedRouteComponent: WrappedPreloadableComponent = props =>
    createElement(Component, props);

  const preloadable = component as PreloadableComponent;
  if (typeof preloadable.load === 'function') {
    WrappedRouteComponent.load = preloadable.load.bind(preloadable);
  }
  if (typeof preloadable.preload === 'function') {
    WrappedRouteComponent.preload = preloadable.preload.bind(preloadable);
  } else if (typeof preloadable.load === 'function') {
    WrappedRouteComponent.preload = WrappedRouteComponent.load;
  }

  return WrappedRouteComponent;
}
