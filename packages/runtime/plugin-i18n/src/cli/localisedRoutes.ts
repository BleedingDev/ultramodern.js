import {
  applyLocalisedUrlsToRoutes,
  resolveLocalisedUrlsConfig,
} from '@modern-js/i18n-runtime-extensions';
import { getEntrypointRoutesOwner } from '@modern-js/runtime/cli';
import type {
  Entrypoint,
  NestedRouteForCli,
  PageRoute,
} from '@modern-js/types';
import type { BaseLocaleDetectionOptions } from '../shared/type';

type FileSystemRoutes = (NestedRouteForCli | PageRoute)[];

/**
 * Expand file-system routes from `localeDetection.localisedUrls`.
 *
 * Fork-owned: the localised-URL engine lives in
 * `@modern-js/i18n-runtime-extensions`, which upstream-owned files must not
 * import. `cli/index.ts` calls this through a relative import so the seam, not
 * the edge, is what appears in the upstream-shaped file.
 *
 * Returns the routes unchanged unless locale-path redirects are on, languages
 * are declared, and a non-empty map is configured — an upstream-style config
 * with `localePathRedirect` and `languages` but no map keeps plain
 * locale-prefix behaviour.
 */
export const applyLocalisedRoutes = (
  routes: FileSystemRoutes,
  localeDetection: BaseLocaleDetectionOptions | undefined,
  entrypoint?: Entrypoint & Parameters<typeof getEntrypointRoutesOwner>[0],
): FileSystemRoutes => {
  const {
    localePathRedirect,
    languages = [],
    localisedUrls,
  } = localeDetection ?? {};
  const resolved = resolveLocalisedUrlsConfig(localisedUrls);

  if (!localePathRedirect || !languages.length || !resolved.enabled) {
    return routes;
  }

  return applyLocalisedUrlsToRoutes(
    routes,
    languages,
    resolved.map,
    entrypoint &&
      getEntrypointRoutesOwner(entrypoint) === '@modern-js/plugin-tanstack'
      ? 'canonical'
      : 'physical',
  ) as FileSystemRoutes;
};
