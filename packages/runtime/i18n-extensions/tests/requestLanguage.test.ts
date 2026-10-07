import { describe, expect, test } from '@rstest/core';
import {
  createRequestLanguageRedirect,
  detectRequestLanguage,
  languageFromPathname,
  resolveRequestLanguage,
} from '../src/requestLanguage';
import { createI18nSsrHandoffInlineData } from '../src/ssrLanguageHandoff';

const languages = ['en', 'cs'];

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${path}`, { headers });

describe('languageFromPathname', () => {
  test('reads the first segment below the base path', () => {
    expect(languageFromPathname('/cs/about', languages)).toBe('cs');
    expect(languageFromPathname('/CS', languages)).toBe('cs');
    expect(languageFromPathname('/about', languages)).toBeUndefined();
    expect(languageFromPathname('/app/en/x', languages, '/app')).toBe('en');
    expect(languageFromPathname('/en/x', languages, '/app')).toBeUndefined();
  });
});

describe('detectRequestLanguage', () => {
  test('follows querystring, cookie, then Accept-Language', () => {
    expect(
      detectRequestLanguage(
        request('/?lng=cs', {
          cookie: 'i18next=en',
          'accept-language': 'en',
        }),
        languages,
      ),
    ).toBe('cs');
    expect(
      detectRequestLanguage(
        request('/', { cookie: 'a=1; i18next=cs', 'accept-language': 'en' }),
        languages,
      ),
    ).toBe('cs');
    expect(
      detectRequestLanguage(
        request('/', { 'accept-language': 'de;q=0.9, cs-CZ;q=0.8, en;q=0.1' }),
        languages,
      ),
    ).toBe('cs');
    expect(
      detectRequestLanguage(
        request('/', { 'accept-language': 'cs;q=0, de' }),
        languages,
      ),
    ).toBeUndefined();
  });

  test('honours custom lookups and order', () => {
    expect(
      detectRequestLanguage(
        request('/', { cookie: 'lang=cs', 'accept-language': 'en' }),
        languages,
        { order: ['header', 'cookie'], lookupCookie: 'lang' },
      ),
    ).toBe('en');
    expect(
      detectRequestLanguage(request('/', { cookie: 'lang=cs' }), languages, {
        lookupCookie: 'lang',
      }),
    ).toBe('cs');
  });

  test.each([
    'fr;Q=0,en;q=1',
    'fr;q=0,en;Q=1',
    'fr;Q=0.2,en;q=0.9',
    'fr;q=0.2,en;Q=0.9',
  ])('honours case-insensitive quality parameters in %s', header => {
    expect(
      detectRequestLanguage(request('/', { 'accept-language': header }), [
        'fr',
        'en',
      ]),
    ).toBe('en');
  });

  test('excludes uppercase quality parameters when every language has zero quality', () => {
    expect(
      detectRequestLanguage(
        request('/', { 'accept-language': 'fr;Q=0,en;q=0' }),
        ['fr', 'en'],
      ),
    ).toBeUndefined();
  });
});

describe('resolveRequestLanguage', () => {
  const options = { languages, fallbackLanguage: 'en' };

  test('renders a prefixed URL in its language', () => {
    expect(
      resolveRequestLanguage(
        request('/cs/about', { 'accept-language': 'en' }),
        options,
      ),
    ).toEqual({ kind: 'language', language: 'cs' });
  });

  test('redirects an unprefixed page to the detected language', () => {
    expect(
      resolveRequestLanguage(
        request('/about?x=1', { 'accept-language': 'cs-CZ,cs;q=0.9' }),
        options,
      ),
    ).toEqual({ kind: 'redirect', language: 'cs', location: '/cs/about?x=1' });
    expect(resolveRequestLanguage(request('/'), options)).toEqual({
      kind: 'redirect',
      language: 'en',
      location: '/en',
    });
    expect(
      resolveRequestLanguage(request('/', { 'accept-language': 'cs' }), {
        ...options,
        detect: false,
      }),
    ).toMatchObject({ location: '/en' });
  });

  test('keeps the base path and mapped localized slugs', () => {
    expect(
      resolveRequestLanguage(
        request('/shop/products', { 'accept-language': 'cs' }),
        {
          ...options,
          basePath: '/shop',
          localisedUrls: { products: { en: 'products', cs: 'produkty' } },
        },
      ),
    ).toEqual({
      kind: 'redirect',
      language: 'cs',
      location: '/shop/cs/produkty',
    });
  });

  test('does not redirect ignored, framework or foreign-entry paths', () => {
    expect(
      resolveRequestLanguage(request('/health', { 'accept-language': 'cs' }), {
        ...options,
        ignoreRedirectRoutes: ['/health'],
      }),
    ).toEqual({ kind: 'language', language: 'cs' });
    expect(
      resolveRequestLanguage(request('/static/js/main.js'), options).kind,
    ).toBe('language');
    expect(
      resolveRequestLanguage(request('/other'), {
        ...options,
        basePath: '/shop',
      }).kind,
    ).toBe('language');
  });

  test('answers with an uncacheable redirect', () => {
    const response = createRequestLanguageRedirect('/cs');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/cs');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Accept-Language, Cookie');
  });
});

describe('createI18nSsrHandoffInlineData', () => {
  test('encodes an escaped public payload for a document nonce', () => {
    const data = createI18nSsrHandoffInlineData({
      language: 'cs',
      resources: { translation: { title: '</script><b>' } },
    });
    expect(data.id).toBe('__modernjs_i18n_ssr__');
    expect(data.payload).not.toContain('</script>');
    expect(() => createI18nSsrHandoffInlineData({ language: '' })).toThrow(
      'nonempty language',
    );
  });
});
