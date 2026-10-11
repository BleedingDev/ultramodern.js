import { describe, expect, test } from '@rstest/core';
import { canonicalPath, configuredLanguage, localizePath } from '../src/paths';

const config = {
  languages: ['en', 'cs'],
  localisedUrls: {
    '/products/:slug': { en: '/products/:slug', cs: '/produkty/:slug' },
  },
};

describe('@modern-js/i18n-runtime-extensions/paths', () => {
  test('localises the pathname while leaving query and hash verbatim', () => {
    expect(
      localizePath(
        '/products/red-shoe?tag=boots&tag=sale#details',
        'cs',
        config,
      ),
    ).toBe('/cs/produkty/red-shoe?tag=boots&tag=sale#details');
    expect(
      canonicalPath('/CS/produkty/red-shoe?tag=boots#details', config),
    ).toBe('/products/red-shoe?tag=boots#details');
  });

  test('configuredLanguage resolves a configured language or throws', () => {
    expect(configuredLanguage('CS', ['en', 'cs'])).toBe('cs');
    expect(() => configuredLanguage('de', ['en', 'cs'])).toThrow(
      new RangeError('Unsupported language "de"; expected one of: en, cs'),
    );
  });
});
