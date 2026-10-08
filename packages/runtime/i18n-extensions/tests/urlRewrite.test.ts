import { describe, expect, test } from '@rstest/core';
import { createI18nUrlRewrite } from '../src/urlRewrite';

const languages = ['en', 'cs'];

function coerce(result: undefined | string | URL, fallback: URL): URL {
  if (typeof result === 'string') return new URL(result);
  if (result instanceof URL) return result;
  return fallback;
}

/**
 * `@tanstack/router-core`'s `rewriteBasepath` is not part of its public
 * `index.ts` barrel — it is applied internally by the `Router` constructor
 * whenever `basepath` and/or `rewrite` are configured (see `router.ts`'s
 * `update()`: `this.rewrite = rewriteBasepath(basepath, caseSensitive,
 * options.rewrite)`). This reproduces that exact composition order, so the
 * test exercises the real contract a `createRouter({ basepath, rewrite })`
 * caller gets, without reaching into a private export.
 */
function composeWithBasepath(
  basepath: string,
  custom: ReturnType<typeof createI18nUrlRewrite>,
) {
  const trimmed = basepath.replace(/^\/+|\/+$/g, '');
  const normalized = `/${trimmed}`;
  return {
    input: ({ url }: { url: URL }) => {
      const pathname = url.pathname;
      if (pathname === normalized) {
        url.pathname = '/';
      } else if (pathname.startsWith(`${normalized}/`)) {
        url.pathname = pathname.slice(normalized.length);
      }
      return coerce(custom.input?.({ url }), url);
    },
    output: ({ url }: { url: URL }) => {
      const rewritten = coerce(custom.output?.({ url }), url);
      rewritten.pathname = `/${trimmed}${rewritten.pathname}`.replace(
        /\/{2,}/g,
        '/',
      );
      return rewritten;
    },
  };
}

const runInput = (
  rewrite: { input?: (args: { url: URL }) => undefined | string | URL },
  href: string,
): string => {
  const result = rewrite.input!({ url: new URL(href) });
  const url =
    typeof result === 'string'
      ? new URL(result)
      : result instanceof URL
        ? result
        : new URL(href);
  return `${url.pathname}${url.search}${url.hash}`;
};

const runOutput = (
  rewrite: { output?: (args: { url: URL }) => undefined | string | URL },
  href: string,
): string => {
  const result = rewrite.output!({ url: new URL(href) });
  const url =
    typeof result === 'string'
      ? new URL(result)
      : result instanceof URL
        ? result
        : new URL(href);
  return `${url.pathname}${url.search}${url.hash}`;
};

describe('createI18nUrlRewrite', () => {
  test('input strips the language prefix to the canonical path', () => {
    const rewrite = createI18nUrlRewrite({
      languages,
      getLanguage: () => 'en',
    });
    expect(runInput(rewrite, 'https://example.com/en/dashboard')).toBe(
      '/dashboard',
    );
    expect(runInput(rewrite, 'https://example.com/cs/dashboard?x=1')).toBe(
      '/dashboard?x=1',
    );
    expect(runInput(rewrite, 'https://example.com/dashboard')).toBe(
      '/dashboard',
    );
  });

  test('output adds the current language prefix to the canonical path', () => {
    let language = 'en';
    const rewrite = createI18nUrlRewrite({
      languages,
      getLanguage: () => language,
    });
    expect(runOutput(rewrite, 'https://example.com/dashboard')).toBe(
      '/en/dashboard',
    );
    language = 'cs';
    expect(runOutput(rewrite, 'https://example.com/dashboard#top')).toBe(
      '/cs/dashboard#top',
    );
  });

  test('output keeps a language already present in the outgoing pathname', () => {
    const rewrite = createI18nUrlRewrite({
      languages,
      getLanguage: () => 'en',
      localisedUrls: {
        '/products/:slug': { en: '/products/:slug', cs: '/produkty/:slug' },
      },
    });
    // A route mask to another language publishes that language's URL.
    expect(runOutput(rewrite, 'https://example.com/cs/produkty/red')).toBe(
      '/cs/produkty/red',
    );
    expect(runOutput(rewrite, 'https://example.com/cs/products/red')).toBe(
      '/cs/produkty/red',
    );
    expect(runOutput(rewrite, 'https://example.com/products/red')).toBe(
      '/en/products/red',
    );
  });

  test('reports the detected language segment on input without mutating callers', () => {
    const detected: string[] = [];
    const rewrite = createI18nUrlRewrite({
      languages,
      getLanguage: () => 'en',
      onLanguageDetected: language => detected.push(language),
    });
    runInput(rewrite, 'https://example.com/CS/dashboard');
    runInput(rewrite, 'https://example.com/dashboard');
    expect(detected).toEqual(['cs']);
  });

  test('uses mapped localized slugs when localisedUrls is configured', () => {
    const localisedUrls = {
      '/products/:slug': { en: '/products/:slug', cs: '/produkty/:slug' },
    };
    const language = 'cs';
    const rewrite = createI18nUrlRewrite({
      languages,
      getLanguage: () => language,
      localisedUrls,
    });
    expect(runOutput(rewrite, 'https://example.com/products/red-shoe')).toBe(
      '/cs/produkty/red-shoe',
    );
    expect(runInput(rewrite, 'https://example.com/cs/produkty/red-shoe')).toBe(
      '/products/red-shoe',
    );
  });

  test('composes with router-core basepath rewrite: basepath outside, language inside', () => {
    let language = 'en';
    const i18nRewrite = createI18nUrlRewrite({
      languages,
      getLanguage: () => language,
    });
    const rewrite = composeWithBasepath('/app', i18nRewrite);

    // Public URL -> canonical router URL: strip basepath, then language.
    expect(runInput(rewrite, 'https://example.com/app/en/dashboard')).toBe(
      '/dashboard',
    );
    expect(runInput(rewrite, 'https://example.com/app/cs/dashboard')).toBe(
      '/dashboard',
    );

    // Canonical router URL -> public URL: add language, then basepath.
    expect(runOutput(rewrite, 'https://example.com/dashboard')).toBe(
      '/app/en/dashboard',
    );
    language = 'cs';
    expect(runOutput(rewrite, 'https://example.com/dashboard')).toBe(
      '/app/cs/dashboard',
    );

    // Exact basepath with no further path still resolves to the root.
    expect(runInput(rewrite, 'https://example.com/app')).toBe('/');
  });
});
