import { describe, expect, test } from '@rstest/core';
import {
  buildLocalizedUrl,
  createLocaleRedirectResponse,
  getLanguageFromPath,
  isStaticResourceRequest,
  shouldIgnoreRedirect,
} from '../src/localeRedirectPolicy';

const languages = ['en', 'cs'];
const request = (url: string) => ({
  url,
  header: () => ({ host: 'example.com' }),
});

describe('locale redirect resource policy', () => {
  test('exempts default static and federation routes, including locale prefixes', () => {
    const paths = [
      '/backend-mf-manifest.json',
      '/backendRemoteEntry.cjs',
      '/mf-manifest.json',
      '/mf-stats.json',
      '/remoteEntry.js',
      // A manifest may name a root entry; the federation layer serves these.
      '/remoteEntry.catalog.js',
      '/backendRemoteEntry.catalog-v2.cjs',
      '/bundles/remoteEntry.js',
      '/bundles/vendor-123.js',
      '/bundles/nested/vendor-123.mjs',
      '/static/app.js',
      '/upload/avatar.png',
    ];

    for (const pathname of paths) {
      expect(isStaticResourceRequest(pathname, [], languages)).toBe(true);
      expect(isStaticResourceRequest(`/cs${pathname}`, [], languages)).toBe(
        true,
      );
      expect(shouldIgnoreRedirect(`/store${pathname}`, '/store/*')).toBe(true);
    }
    // Only the entry itself, not a page or asset that merely starts like one.
    for (const pathname of [
      '/remoteEntry.catalog.js.map',
      '/remoteEntry.catalog/js',
      '/products/remoteEntry.js',
      '/bundles-extra/vendor-123.js',
      '/bundles/catalog',
      '/bundles/vendor-123.js.map',
    ]) {
      expect(isStaticResourceRequest(pathname, [], languages)).toBe(false);
    }
  });

  test('configured static prefixes match complete path segments with or without a locale', () => {
    for (const pathname of ['/assets', '/assets/app.js', '/en/assets/app.js']) {
      expect(isStaticResourceRequest(pathname, ['/assets/'], languages)).toBe(
        true,
      );
    }
    for (const pathname of [
      '/assets-extra/app.js',
      '/cs/assets-extra/app.js',
    ]) {
      expect(isStaticResourceRequest(pathname, ['/assets'], languages)).toBe(
        false,
      );
    }
    expect(
      isStaticResourceRequest('/fr/assets/app.js', ['/assets'], languages),
    ).toBe(false);
    expect(
      isStaticResourceRequest('/remoteEntry.js/product', [], languages),
    ).toBe(false);
    expect(isStaticResourceRequest('/static-product', [])).toBe(false);
  });

  test('custom ignore lists operate after stripping the mount path', () => {
    expect(
      shouldIgnoreRedirect('/store/health/live', '/store/*', ['/health']),
    ).toBe(true);
    expect(
      shouldIgnoreRedirect('/store/healthy', '/store/*', ['/health']),
    ).toBe(false);
    expect(shouldIgnoreRedirect('/store/products', '/store/*')).toBe(false);
  });

  test('custom callbacks receive the remaining pathname and default exemptions take priority', () => {
    const seen: string[] = [];
    const ignore = (pathname: string) => {
      seen.push(pathname);
      return pathname === '/health';
    };

    expect(shouldIgnoreRedirect('/store/health', '/store/*', ignore)).toBe(
      true,
    );
    expect(shouldIgnoreRedirect('/store/products', '/store/*', ignore)).toBe(
      false,
    );
    expect(
      shouldIgnoreRedirect('/store/static/app.js', '/store/*', ignore),
    ).toBe(true);
  });
});

describe('locale redirect URL policy', () => {
  test('detects a configured first language segment for relative or absolute URLs', () => {
    expect(
      getLanguageFromPath(
        request('/store/cs/products?x=1'),
        '/store/*',
        languages,
      ),
    ).toBe('cs');
    expect(
      getLanguageFromPath(
        request('https://example.com/en/products'),
        '/',
        languages,
      ),
    ).toBe('en');
    expect(getLanguageFromPath(request('/cs/products'), '', languages)).toBe(
      'cs',
    );
    expect(
      getLanguageFromPath(request('/storecs/products'), '/store/*', languages),
    ).toBe('cs');
  });

  test('switches localized dynamic paths while preserving mount, query and hash', () => {
    expect(
      buildLocalizedUrl(
        request(
          'https://example.com/store/en/products/red%20tractor?q=a%2Fb&sort=price#details',
        ),
        '/store/*',
        'cs',
        languages,
        { '/products/:slug': { en: '/products/:slug', cs: '/produkty/:slug' } },
      ),
    ).toBe('/store/cs/produkty/red%20tractor?q=a%2Fb&sort=price#details');
  });

  test('supports root and empty mounts and missing locale mapping', () => {
    for (const mount of ['/', '', '/*']) {
      expect(
        buildLocalizedUrl(
          request('https://example.com/products?x=1#top'),
          mount,
          'cs',
          languages,
        ),
      ).toBe('/cs/products?x=1#top');
    }
    expect(
      buildLocalizedUrl(
        request('https://example.com/store'),
        '/store/*',
        'cs',
        languages,
        false,
      ),
    ).toBe('/store/cs');
  });

  test('returns a non-cacheable temporary redirect with language negotiation headers', async () => {
    const response = createLocaleRedirectResponse(
      '/cs/produkty?sort=price#details',
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      '/cs/produkty?sort=price#details',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Accept-Language, Cookie');
    expect(await response.text()).toBe('');
  });
});
