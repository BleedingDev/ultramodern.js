import {
  type LocalisedUrlsOption,
  localiseTargetPathname,
  shouldSkipLocaleRedirect,
} from '@modern-js/runtime-extensions/localised-urls';

/**
 * Renderer-neutral request language resolution for path-prefixed locales.
 * It is the Fetch-native counterpart of `@modern-js/plugin-i18n`'s Hono
 * language-detector + redirect middleware pair: a native renderer's request
 * handler calls it with the standard `Request`, so it needs neither Hono nor
 * React and runs unchanged on Node and in workers.
 */
export type RequestLanguageDetector = 'querystring' | 'cookie' | 'header';

export interface RequestLanguageDetection {
  /** @default ['querystring', 'cookie', 'header'] */
  order?: readonly RequestLanguageDetector[];
  /** @default 'lng' */
  lookupQuerystring?: string;
  /** @default 'i18next' */
  lookupCookie?: string;
  /** @default 'accept-language' */
  lookupHeader?: string;
}

export interface ResolveRequestLanguageOptions {
  languages: readonly string[];
  fallbackLanguage: string;
  /** Public path the entry is mounted under. @default '/' */
  basePath?: string;
  localisedUrls?: LocalisedUrlsOption;
  /**
   * Detect the language of an unprefixed URL from the query string, cookie
   * and `Accept-Language`. When false the fallback language is used.
   * @default true
   */
  detect?: boolean;
  detection?: RequestLanguageDetection;
  /** Canonical paths that are served without a language prefix. */
  ignoreRedirectRoutes?: readonly string[] | ((pathname: string) => boolean);
}

export type ResolvedRequestLanguage =
  | { kind: 'language'; language: string }
  | { kind: 'redirect'; language: string; location: string };

const DEFAULT_ORDER: readonly RequestLanguageDetector[] = [
  'querystring',
  'cookie',
  'header',
];

const normaliseBasePath = (basePath: string | undefined): string => {
  if (!basePath || basePath === '/') return '';
  return `/${basePath.split('/').filter(Boolean).join('/')}`;
};

/** The pathname below the entry base path, or `undefined` outside it. */
const entryPathname = (
  pathname: string,
  basePath: string | undefined,
): string | undefined => {
  const base = normaliseBasePath(basePath);
  if (!base) return pathname || '/';
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length)
    : undefined;
};

const baseLanguage = (tag: string) => tag.toLowerCase().split(/[-_]/u)[0];

/**
 * Supported languages a range covers, best first: the exact tag, the range's
 * base language (`cs-CZ` -> `cs`), then regional languages under a base range
 * (`en` -> `en-US`, `en-GB`).
 */
const compatibleLanguages = (
  candidate: string | null | undefined,
  languages: readonly string[],
): string[] => {
  const value = candidate?.trim().toLowerCase();
  if (!value) return [];
  const base = baseLanguage(value);
  return [
    ...languages.filter(language => language.toLowerCase() === value),
    ...languages.filter(language => language.toLowerCase() === base),
    ...(base === value
      ? languages.filter(language => baseLanguage(language) === value)
      : []),
  ].filter((language, index, all) => all.indexOf(language) === index);
};

const matchLanguage = (
  candidate: string | null | undefined,
  languages: readonly string[],
): string | undefined => compatibleLanguages(candidate, languages)[0];

/** The supported language carried by a public pathname's first segment. */
export function languageFromPathname(
  pathname: string,
  languages: readonly string[],
  basePath?: string,
): string | undefined {
  const remaining = entryPathname(pathname, basePath);
  if (remaining === undefined) return undefined;
  const first = remaining.split('/').filter(Boolean)[0];
  if (!first) return undefined;
  return languages.find(
    language => language.toLowerCase() === first.toLowerCase(),
  );
}

const readCookie = (header: string | null, name: string): string | null => {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
};

const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * How specifically a range covers a supported language: the exact tag, then
 * longer prefix ranges (`en` for `en-US`), then a regional range naming the
 * base language (`cs-CZ` for `cs`), then `*`. `undefined` when it does not.
 */
const rangeSpecificity = (
  range: string,
  language: string,
): number | undefined => {
  const value = range.toLowerCase().replaceAll('_', '-');
  const supported = language.toLowerCase().replaceAll('_', '-');
  if (value === '*') return 0;
  if (value === supported) return Number.MAX_SAFE_INTEGER;
  if (supported.startsWith(`${value}-`)) return 1 + value.split('-').length;
  if (baseLanguage(value) === supported) return 1;
  return undefined;
};

/**
 * Supported languages in `Accept-Language` order, highest quality first. A
 * language's quality comes from the most specific range covering it, and `*`
 * covers every language no other range names.
 */
const acceptedLanguages = (
  header: string | null,
  languages: readonly string[],
): string[] => {
  const items = (header ?? '')
    .split(',')
    .map((item, index) => {
      const [tag, ...parameters] = item.trim().split(';');
      const quality = parameters
        .map(parameter => parameter.trim())
        .find(parameter => parameter.toLowerCase().startsWith('q='));
      // RFC 9110 qvalue: 0 to 1 with at most three decimals. A malformed
      // weight drops the item instead of reordering preferences.
      const value = quality?.slice(2).trim();
      const q =
        value === undefined ? 1 : QVALUE.test(value) ? Number(value) : 0;
      return { tag: tag.trim(), q, index };
    })
    .filter(item => item.tag);
  // Each supported language takes the quality of its most specific range, so
  // `en;q=0, en-US` keeps en-US while excluding the other English locales.
  const ranked = languages.flatMap((language, position) => {
    let best: { q: number; index: number; specificity: number } | undefined;
    for (const item of items) {
      const specificity = rangeSpecificity(item.tag, language);
      if (
        specificity !== undefined &&
        (!best || specificity > best.specificity)
      )
        best = { q: item.q, index: item.index, specificity };
    }
    return best && best.q > 0 ? [{ language, position, ...best }] : [];
  });
  return ranked
    .sort(
      (left, right) =>
        right.q - left.q ||
        left.index - right.index ||
        right.specificity - left.specificity ||
        left.position - right.position,
    )
    .map(entry => entry.language);
};

/**
 * Detect a supported language from the request alone (no path), in the
 * configured detector order. Returns `undefined` when nothing matches.
 */
export function detectRequestLanguage(
  request: Request,
  languages: readonly string[],
  detection: RequestLanguageDetection = {},
): string | undefined {
  const url = new URL(request.url);
  for (const detector of detection.order ?? DEFAULT_ORDER) {
    let language: string | undefined;
    if (detector === 'querystring') {
      language = matchLanguage(
        url.searchParams.get(detection.lookupQuerystring ?? 'lng'),
        languages,
      );
    } else if (detector === 'cookie') {
      language = matchLanguage(
        readCookie(
          request.headers.get('cookie'),
          detection.lookupCookie ?? 'i18next',
        ),
        languages,
      );
    } else if (detector === 'header') {
      language = acceptedLanguages(
        request.headers.get(detection.lookupHeader ?? 'accept-language'),
        languages,
      ).find(Boolean);
    }
    if (language) return language;
  }
  return undefined;
}

/**
 * Resolve the language a request renders in. A URL that already carries a
 * supported language prefix renders in it; an unprefixed page URL is
 * redirected to the detected (or fallback) language's localized URL, keeping
 * search and the base path, unless it is an ignored or framework-owned path.
 */
export function resolveRequestLanguage(
  request: Request,
  options: ResolveRequestLanguageOptions,
): ResolvedRequestLanguage {
  const { languages, fallbackLanguage } = options;
  const url = new URL(request.url);
  const fromPath = languageFromPathname(
    url.pathname,
    languages,
    options.basePath,
  );
  if (fromPath) return { kind: 'language', language: fromPath };
  const detected =
    (options.detect === false
      ? undefined
      : detectRequestLanguage(request, languages, options.detection)) ??
    fallbackLanguage;
  const remaining = entryPathname(url.pathname, options.basePath);
  if (
    remaining === undefined ||
    shouldSkipLocaleRedirect(
      remaining,
      [...languages],
      options.ignoreRedirectRoutes as
        | string[]
        | ((pathname: string) => boolean)
        | undefined,
    )
  ) {
    return { kind: 'language', language: detected };
  }
  const localized = localiseTargetPathname(
    remaining,
    detected,
    [...languages],
    options.localisedUrls,
  );
  return {
    kind: 'redirect',
    language: detected,
    location: `${normaliseBasePath(options.basePath)}${localized}${url.search}`,
  };
}

/** The same uncacheable 302 the React server middleware answers with. */
export function createRequestLanguageRedirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      'cache-control': 'private, no-store',
      location,
      vary: 'Accept-Language, Cookie',
    },
  });
}
