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

const matchLanguage = (
  candidate: string | null | undefined,
  languages: readonly string[],
): string | undefined => {
  if (!candidate) return undefined;
  const value = candidate.trim().toLowerCase();
  if (!value) return undefined;
  return (
    languages.find(language => language.toLowerCase() === value) ??
    languages.find(
      language => language.toLowerCase() === value.split(/[-_]/u)[0],
    )
  );
};

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

/** Ordered `Accept-Language` tags, highest quality first; `q=0` is excluded. */
const acceptedLanguages = (header: string | null): string[] =>
  (header ?? '')
    .split(',')
    .map((item, index) => {
      const [tag, ...parameters] = item.trim().split(';');
      const quality = parameters
        .map(parameter => parameter.trim())
        .find(parameter => parameter.startsWith('q='));
      const q = quality ? Number(quality.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter(item => item.tag && item.tag !== '*' && item.q > 0)
    .sort((left, right) => right.q - left.q || left.index - right.index)
    .map(item => item.tag);

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
      for (const tag of acceptedLanguages(
        request.headers.get(detection.lookupHeader ?? 'accept-language'),
      )) {
        language = matchLanguage(tag, languages);
        if (language) break;
      }
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
