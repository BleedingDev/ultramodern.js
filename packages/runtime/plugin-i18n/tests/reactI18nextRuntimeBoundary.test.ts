import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from '@rstest/core';
import { build } from 'esbuild';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const runtimeRoot = resolve(__dirname, '../src/runtime');

describe('react-i18next runtime boundary', () => {
  test('bundles the disabled runtime entry when react-i18next is unavailable', async () => {
    await expect(
      build({
        bundle: true,
        entryPoints: [resolve(runtimeRoot, 'no-react-i18next.tsx')],
        format: 'esm',
        packages: 'external',
        platform: 'node',
        plugins: [
          {
            name: 'reject-react-i18next',
            setup(buildApi) {
              buildApi.onResolve({ filter: /^react-i18next$/ }, () => {
                throw new Error(
                  'disabled runtime entry reached optional react-i18next',
                );
              });
            },
          },
        ],
        write: false,
      }),
    ).resolves.toBeDefined();
  });

  test('gets router capabilities from the selected runtime provider', async () => {
    await expect(
      build({
        bundle: true,
        entryPoints: [resolve(runtimeRoot, 'routerAdapter.tsx')],
        format: 'esm',
        packages: 'external',
        platform: 'neutral',
        plugins: [
          {
            name: 'reject-direct-router-provider',
            setup(buildApi) {
              buildApi.onResolve(
                { filter: /^@modern-js\/runtime\/router$/ },
                () => {
                  throw new Error(
                    'The i18n adapter loaded the React Router provider directly.',
                  );
                },
              );
            },
          },
        ],
        write: false,
      }),
    ).resolves.toBeDefined();
  });

  test('independently bundled runtime copies share the contexts subpath', async () => {
    const tempDir = await mkdtemp(
      resolve(__dirname, '.modern-i18n-runtime-boundary-'),
    );
    try {
      const contextEntry = resolve(runtimeRoot, 'context.tsx');
      const copies = await Promise.all(
        ['copy-a.mjs', 'copy-b.mjs'].map(async filename => {
          const outfile = resolve(tempDir, filename);
          await build({
            bundle: true,
            entryPoints: [contextEntry],
            format: 'esm',
            jsx: 'automatic',
            outfile,
            packages: 'external',
            platform: 'node',
            // Resolve the contexts self-reference like an installed package,
            // not through this package's tsconfig `paths`.
            tsconfigRaw: {},
          });
          return import(pathToFileURL(outfile).href);
        }),
      );
      const [copyA, copyB] = copies;
      const instance = i18next.createInstance();
      await instance.init({
        initImmediate: false,
        lng: 'cs',
        resources: { cs: { translation: { language: 'Jazyk' } } },
      });
      const Consumer = () =>
        createElement('span', null, copyB.useModernI18n().language);

      const html = renderToStaticMarkup(
        createElement(
          copyA.ModernI18nProvider,
          {
            value: {
              i18nInstance: instance,
              language: 'cs',
              languages: ['en', 'cs'],
            },
          },
          createElement(Consumer),
        ),
      );

      expect(html).toBe('<span>cs</span>');
      expect(
        Object.getOwnPropertySymbols(globalThis).map(String),
      ).not.toContainEqual(expect.stringContaining('@modern-js/plugin-i18n'));
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
