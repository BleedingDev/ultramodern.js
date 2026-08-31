import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createJsonLdHelperModule,
  createPublicRouteMetadataFromRoutes,
} from '../src/ultramodern-workspace/routes';
import type { RouteOwnedI18nPath } from '../src/ultramodern-workspace/types';
import { runStableTypeScript } from './helpers/stable-typescript';

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

test('generated JSON-LD helper module executes every public builder', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-jsonld-runtime-'));
  const helperPath = path.join(tempRoot, 'ultramodern-jsonld.ts');
  const usagePath = path.join(tempRoot, 'usage.ts');
  const outputRoot = path.join(tempRoot, 'dist');

  try {
    fs.writeFileSync(helperPath, createJsonLdHelperModule());
    fs.writeFileSync(
      usagePath,
      `import {
  breadcrumbListJsonLd,
  defineRouteJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webApplicationJsonLd,
  webPageJsonLd,
} from './ultramodern-jsonld';

const values = [
  webPageJsonLd({ name: 'Page', url: 'https://example.test/page' }),
  webApplicationJsonLd({ name: 'Web app', url: 'https://example.test/app' }),
  softwareApplicationJsonLd({ name: 'Software', url: 'https://example.test/software' }),
  breadcrumbListJsonLd([{ name: 'Home', item: 'https://example.test/' }]),
  faqPageJsonLd([{ name: 'Question', acceptedAnswer: { text: 'Answer' } }]),
  organizationJsonLd({ name: 'Organization' }),
];
const routeValue = defineRouteJsonLd(values);
if (routeValue !== values || values.some(value => value['@context'] !== 'https://schema.org')) {
  throw new Error('generated JSON-LD builders violated their runtime contract');
}
`,
    );
    const compiled = runStableTypeScript(
      [
        usagePath,
        '--ignoreConfig',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--outDir',
        outputRoot,
        '--pretty',
        'false',
        '--skipLibCheck',
        '--strict',
        '--target',
        'es2022',
      ],
      tempRoot,
    );
    assert.equal(compiled.status, 0, compiled.output);
    const executed = spawnSync(
      process.execPath,
      [path.join(outputRoot, 'usage.js')],
      { encoding: 'utf-8' },
    );
    assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
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

    const result = runStableTypeScript(
      [
        usagePath,
        '--ignoreConfig',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--noEmit',
        '--pretty',
        'false',
        '--skipLibCheck',
        '--strict',
        '--target',
        'es2022',
      ],
      tempRoot,
    );
    assert.equal(result.status, 0, result.output);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
