import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from '@typescript/typescript6';
import {
  createJsonLdHelperModule,
  createPublicRouteMetadataFromRoutes,
} from '../src/ultramodern-workspace/routes';
import type { RouteOwnedI18nPath } from '../src/ultramodern-workspace/types';

const baseRoute: RouteOwnedI18nPath = {
  canonicalPath: '/',
  descriptionKey: 'shell.seo.description',
  id: 'shell-home',
  indexable: false,
  localisedPaths: {
    cs: '/',
    en: '/',
  },
  mfBoundaryId: 'shellSuperApp',
  namespace: 'shell',
  ownerAppId: 'shell-super-app',
  public: false,
  publicSurface: 'private-app-screen',
  titleKey: 'shell.title',
};

test('public route metadata carries only explicitly authored JSON-LD', () => {
  const explicitJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Public help',
    url: 'https://example.test/help',
  } as const;

  const publicRoutes = createPublicRouteMetadataFromRoutes([
    {
      ...baseRoute,
      id: 'private-dashboard',
      jsonLd: explicitJsonLd,
    },
    {
      ...baseRoute,
      canonicalPath: '/pricing',
      id: 'public-pricing',
      indexable: true,
      localisedPaths: {
        cs: '/ceny',
        en: '/pricing',
      },
      public: true,
      publicSurface: 'explicit-public-input',
    },
    {
      ...baseRoute,
      canonicalPath: '/help',
      id: 'public-help',
      indexable: true,
      jsonLd: explicitJsonLd,
      localisedPaths: {
        cs: '/napoveda',
        en: '/help',
      },
      public: true,
      publicSurface: 'explicit-public-input',
    },
  ]);

  assert.deepEqual(publicRoutes, [
    {
      canonicalPath: '/pricing',
      descriptionKey: 'shell.seo.description',
      id: 'public-pricing',
      localisedPaths: {
        cs: '/ceny',
        en: '/pricing',
      },
      namespace: 'shell',
      ownerAppId: 'shell-super-app',
      titleKey: 'shell.title',
    },
    {
      canonicalPath: '/help',
      descriptionKey: 'shell.seo.description',
      id: 'public-help',
      jsonLd: explicitJsonLd,
      localisedPaths: {
        cs: '/napoveda',
        en: '/help',
      },
      namespace: 'shell',
      ownerAppId: 'shell-super-app',
      titleKey: 'shell.title',
    },
  ]);
});

test('generated JSON-LD helper module exposes typed builders without inference policy', () => {
  const helperModule = createJsonLdHelperModule();

  for (const snippet of [
    'export const defineRouteJsonLd',
    'export const webPageJsonLd',
    'export const webApplicationJsonLd',
    'export const softwareApplicationJsonLd',
    'export const breadcrumbListJsonLd',
    'export const faqPageJsonLd',
    'export const organizationJsonLd',
    "const schemaContext = 'https://schema.org' as const",
  ]) {
    assert.match(
      helperModule,
      new RegExp(snippet.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')),
    );
  }

  assert.doesNotMatch(helperModule, /infer/u);
});

test('generated JSON-LD types reject scalar route metadata', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-jsonld-types-'));
  const helperPath = path.join(tempRoot, 'ultramodern-jsonld.ts');
  const usagePath = path.join(tempRoot, 'usage.ts');

  try {
    fs.writeFileSync(helperPath, createJsonLdHelperModule());
    fs.writeFileSync(
      usagePath,
      `import { defineRouteJsonLd, webPageJsonLd, type RouteJsonLd } from './ultramodern-jsonld';

const validObject = defineRouteJsonLd(webPageJsonLd({
  name: 'Public help',
  url: 'https://example.test/help',
}));
const validArray = defineRouteJsonLd([validObject]);

const publicRoute: { jsonLd?: RouteJsonLd } = {
  jsonLd: validArray,
};
void publicRoute;

// @ts-expect-error scalar strings are not route-level JSON-LD.
defineRouteJsonLd('not json ld');
// @ts-expect-error scalar numbers are not route-level JSON-LD.
const scalarNumberRoute: { jsonLd?: RouteJsonLd } = { jsonLd: 1 };
// @ts-expect-error scalar arrays are not route-level JSON-LD.
const scalarArrayRoute: { jsonLd?: RouteJsonLd } = { jsonLd: ['not object'] };
void scalarNumberRoute;
void scalarArrayRoute;
`,
    );

    const program = ts.createProgram([usagePath], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);

    assert.deepEqual(
      diagnostics.map(diagnostic =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ),
      [],
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
