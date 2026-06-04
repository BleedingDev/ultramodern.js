import { Outlet as TanstackOutlet } from '@tanstack/react-router';
import {
  type ComponentProps,
  createElement,
  type ElementType,
  memo,
} from 'react';

type PreloadableComponent = ElementType<Record<string, unknown>> & {
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
  if (!component) {
    return component;
  }

  const Component = component as ElementType<Record<string, unknown>>;
  const WrappedRouteComponent = (
    props: ComponentProps<ElementType<Record<string, unknown>>>,
  ) => createElement(Component, props);

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
