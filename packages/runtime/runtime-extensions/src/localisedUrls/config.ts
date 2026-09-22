import type { LocalisedUrlsOption, ResolvedLocalisedUrlsConfig } from './types';

/**
 * Localised URLs are strictly opt-in: only an explicit, non-empty map enables
 * route expansion and validation. `true`, `false`, an empty map and absence
 * all resolve to disabled, so upstream-style configs (`localePathRedirect` +
 * `languages` without a map) keep plain locale-prefix behavior instead of
 * failing the build for every route missing from a map they never wrote.
 */
export const resolveLocalisedUrlsConfig = (
  option: LocalisedUrlsOption | undefined,
): ResolvedLocalisedUrlsConfig => {
  if (option && typeof option === 'object' && Object.keys(option).length > 0) {
    return { enabled: true, map: option };
  }

  return { enabled: false, map: {} };
};
