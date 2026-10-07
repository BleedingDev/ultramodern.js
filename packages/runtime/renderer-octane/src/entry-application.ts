import type { LocalisedUrlsOption } from '@modern-js/i18n-runtime-extensions/paths';
import type { NativeI18nView } from '@modern-js/renderer-core/entry-client';
import type { NativeRouterFactory } from '@modern-js/renderer-core/router';
import {
  type AnyRoute,
  type AnyRouter,
  createMemoryHistory,
  createRouter,
} from '@octanejs/tanstack-router';
import { type ComponentBody, createElement } from 'octane';
import { I18nProvider } from './i18n/I18nProvider';
import type { I18nInstanceLike } from './i18n/types';
import {
  createFileSystemRouteTree,
  type FileSystemRouteModule,
} from './routes';

export type OctaneI18nView = NativeI18nView<unknown, LocalisedUrlsOption>;

/** The Octane route tree and router of a generated entry. */
export const octaneRouterFactory: NativeRouterFactory<AnyRoute, AnyRouter> = {
  routeTree: (routes, modules, options) =>
    createFileSystemRouteTree(
      routes,
      modules as Readonly<Record<string, FileSystemRouteModule>>,
      options,
    ),
  router: ({ location, ...options }) =>
    createRouter({
      ...options,
      ...(location
        ? {
            origin: location.origin,
            history: createMemoryHistory({ initialEntries: [location.href] }),
          }
        : {}),
    }),
};

interface LocalizedRouterProps {
  readonly router: AnyRouter;
  readonly i18n: OctaneI18nView;
}

/** Wrap a router root in the request's or document's i18n provider. */
export function localizedRouterRoot(
  Root: ComponentBody<{ router: AnyRouter }>,
): ComponentBody<LocalizedRouterProps> {
  return ({ router, i18n }) =>
    createElement(I18nProvider, {
      instance: i18n.instance as I18nInstanceLike,
      languages: i18n.languages,
      localisedUrls: i18n.localisedUrls,
      children: createElement(Root, { router }),
    });
}
