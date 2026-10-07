import type { LocalisedUrlsOption } from '@modern-js/i18n-runtime-extensions/paths';
import type { NativeI18nView } from '@modern-js/renderer-core/entry-client';
import type { NativeRouterFactory } from '@modern-js/renderer-core/router';
import type { JSX } from '@solidjs/web';
import type { Component } from 'solid-js';
import { ApplicationRouter } from './application-router';
import { I18nProvider } from './i18n/I18nProvider';
import type { I18nInstanceLike } from './i18n/types';
import { createApplicationRouter } from './route-completion';
import {
  createFileSystemRouteTree,
  type FileSystemRouteModule,
} from './router';
import {
  type AnyRoute,
  type AnyRouter,
  createMemoryHistory,
} from './router-binding/index';

export type SolidI18nView = NativeI18nView<unknown, LocalisedUrlsOption>;

/** The Solid route tree and router of a generated entry. */
export const solidRouterFactory: NativeRouterFactory<AnyRoute, AnyRouter> = {
  routeTree: (routes, modules, options) =>
    createFileSystemRouteTree(
      routes,
      modules as Readonly<Record<string, FileSystemRouteModule>>,
      options,
    ),
  router: ({ location, ...options }) =>
    createApplicationRouter({
      ...options,
      ...(location
        ? {
            origin: location.origin,
            history: createMemoryHistory({ initialEntries: [location.href] }),
          }
        : {}),
    }),
};

export function componentView(component: unknown): () => JSX.Element {
  const App = component as Component;
  return () => <App />;
}

export function routerView(
  router: AnyRouter,
  i18n?: SolidI18nView,
): () => JSX.Element {
  if (!i18n) return () => <ApplicationRouter router={router} />;
  return () => (
    <I18nProvider
      instance={i18n.instance as I18nInstanceLike}
      languages={i18n.languages}
      localisedUrls={i18n.localisedUrls}
    >
      <ApplicationRouter router={router} />
    </I18nProvider>
  );
}
