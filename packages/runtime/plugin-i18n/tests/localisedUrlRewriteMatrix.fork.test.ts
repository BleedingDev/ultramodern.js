import { describe, expect, test } from '@rstest/core';
import {
  interpolateRouteParams,
  normalizeSearch,
} from '../src/runtime/linkHelpers';
import { canonicalPath, localizePath } from '../src/runtime/localizedPaths';
import { buildLocalizedUrl } from '../src/runtime/utils';
import type { LocalisedUrlsMap } from '../src/shared/localisedUrls';

const languages = ['en', 'cs'];

const localisedUrls = {
  '/products/:slug': {
    en: '/products/:slug',
    cs: '/produkty/:slug',
  },
  '/files/*': {
    en: '/files/*',
    cs: '/soubory/*',
  },
  '/app/products/:slug': {
    en: '/app/products/:slug',
    cs: '/app/produkty/:slug',
  },
} satisfies LocalisedUrlsMap;

const pathsConfig = {
  languages,
  localisedUrls,
};

describe('fork-owned localised URL rewrite matrix', () => {
  const rewriteScenarios = [
    {
      name: 'adds the target locale prefix and localises canonical segments',
      target: '/products/red-shoe',
      language: 'cs',
      expected: '/cs/produkty/red-shoe',
    },
    {
      name: 'strips a case-insensitive source locale before relocalising',
      target: '/CS/produkty/red%20shoe?tag=boots#details',
      language: 'en',
      expected: '/en/products/red%20shoe?tag=boots#details',
    },
    {
      name: 'preserves repeated query keys and the fragment',
      target: '/products/red-shoe?tag=boots&tag=sale#details',
      language: 'cs',
      expected: '/cs/produkty/red-shoe?tag=boots&tag=sale#details',
    },
    {
      name: 'keeps a base-path segment inside the localised route map',
      target: '/app/products/red-shoe?ref=nav#details',
      language: 'cs',
      expected: '/cs/app/produkty/red-shoe?ref=nav#details',
    },
    {
      name: 'keeps the default locale explicitly prefixed',
      target: '/products/red-shoe',
      language: 'en',
      expected: '/en/products/red-shoe',
    },
    {
      name: 'does not double-prefix an already-localised URL',
      target: '/cs/produkty/red-shoe?tag=boots#details',
      language: 'cs',
      expected: '/cs/produkty/red-shoe?tag=boots#details',
    },
  ];

  for (const scenario of rewriteScenarios) {
    test(scenario.name, () => {
      expect(
        buildLocalizedUrl(
          scenario.target,
          scenario.language,
          languages,
          localisedUrls,
        ),
      ).toBe(scenario.expected);
    });
  }

  test('canonical and localized path helpers strip and add prefixes exactly', () => {
    expect(
      canonicalPath('/CS/produkty/red-shoe?tag=boots#details', pathsConfig),
    ).toBe('/products/red-shoe?tag=boots#details');
    expect(
      localizePath('/products/red-shoe?tag=boots#details', 'cs', pathsConfig),
    ).toBe('/cs/produkty/red-shoe?tag=boots#details');
  });

  test('splat params preserve separators and percent-encode each segment', () => {
    const target = interpolateRouteParams('/files/*', {
      '*': 'resume drafts/Q1 deck.pdf',
    });

    expect(target).toBe('/files/resume%20drafts/Q1%20deck.pdf');
    expect(buildLocalizedUrl(target, 'cs', languages, localisedUrls)).toBe(
      '/cs/soubory/resume%20drafts/Q1%20deck.pdf',
    );
  });

  const searchScenarios: Array<{
    name: string;
    search: Parameters<typeof normalizeSearch>[0];
    searchFromTo: string;
    expected: ReturnType<typeof normalizeSearch>;
  }> = [
    {
      name: 'object array values are preserved',
      search: { tag: ['boots', 'sale'], page: 2 },
      searchFromTo: '?ignored=1',
      expected: {
        searchString: '?tag=boots&tag=sale&page=2',
        searchObject: { tag: ['boots', 'sale'], page: '2' },
      },
    },
    {
      name: 'target query arrays are preserved',
      search: undefined,
      searchFromTo: '?tag=boots&tag=sale&page=2',
      expected: {
        searchString: '?tag=boots&tag=sale&page=2',
        searchObject: { tag: ['boots', 'sale'], page: '2' },
      },
    },
    {
      name: 'empty search clears the target query',
      search: '',
      searchFromTo: '?tag=boots&tag=sale',
      expected: {
        searchString: '',
        searchObject: undefined,
      },
    },
  ];

  for (const scenario of searchScenarios) {
    test(`normalizes search: ${scenario.name}`, () => {
      expect(normalizeSearch(scenario.search, scenario.searchFromTo)).toEqual(
        scenario.expected,
      );
    });
  }
});
