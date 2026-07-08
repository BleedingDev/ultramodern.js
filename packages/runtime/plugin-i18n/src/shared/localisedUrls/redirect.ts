import { normalisePathname } from './normalise';
import { stripLanguagePrefix } from './pathname';

export type LocaleRedirectSkipRule =
  | {
      type: 'exact';
      path: string;
    }
  | {
      type: 'prefix';
      path: string;
    };

export const DEFAULT_LOCALE_REDIRECT_SKIP_RULES: readonly LocaleRedirectSkipRule[] =
  [
    { type: 'exact', path: '/mf-manifest.json' },
    { type: 'exact', path: '/mf-stats.json' },
    { type: 'exact', path: '/remoteEntry.js' },
    { type: 'prefix', path: '/static/' },
    { type: 'prefix', path: '/upload/' },
  ];

const stripTrailingSlash = (pathname: string): string =>
  pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

export const matchesPathPrefix = (
  pathname: string,
  prefix: string,
): boolean => {
  const normalizedPathname = normalisePathname(pathname);
  const normalizedPrefix = stripTrailingSlash(normalisePathname(prefix));

  return (
    normalizedPathname === normalizedPrefix ||
    normalizedPathname.startsWith(`${normalizedPrefix}/`)
  );
};

const matchesSkipRule = (
  pathname: string,
  rule: LocaleRedirectSkipRule,
): boolean => {
  if (rule.type === 'exact') {
    return normalisePathname(pathname) === normalisePathname(rule.path);
  }

  return matchesPathPrefix(pathname, rule.path);
};

export const isDefaultLocaleRedirectSkipPath = (
  pathname: string,
  languages: string[] = [],
): boolean => {
  const normalizedPathname = normalisePathname(pathname);
  const pathWithoutLanguage = stripLanguagePrefix(
    normalizedPathname,
    languages,
  );

  return DEFAULT_LOCALE_REDIRECT_SKIP_RULES.some(rule =>
    matchesSkipRule(pathWithoutLanguage, rule),
  );
};

export const shouldSkipLocaleRedirect = (
  pathname: string,
  languages: string[] = [],
  ignoreRedirectRoutes?: string[] | ((pathname: string) => boolean),
): boolean => {
  const normalizedPathname = normalisePathname(pathname);
  const pathWithoutLanguage = stripLanguagePrefix(
    normalizedPathname,
    languages,
  );

  if (isDefaultLocaleRedirectSkipPath(pathWithoutLanguage)) {
    return true;
  }

  if (!ignoreRedirectRoutes) {
    return false;
  }

  if (typeof ignoreRedirectRoutes === 'function') {
    return ignoreRedirectRoutes(pathWithoutLanguage);
  }

  return ignoreRedirectRoutes.some(pattern =>
    matchesPathPrefix(pathWithoutLanguage, pattern),
  );
};
