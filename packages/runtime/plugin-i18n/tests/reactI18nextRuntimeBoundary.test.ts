import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from '@rstest/core';
import { build } from 'esbuild';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18nPlugin as noReactI18nextPlugin } from '../src/runtime/no-react-i18next';

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

  test('bundles the default runtime entry with the react-i18next adapter', async () => {
    let adapterResolutions = 0;
    await build({
      bundle: true,
      entryPoints: [resolve(runtimeRoot, 'index.tsx')],
      format: 'esm',
      packages: 'external',
      platform: 'node',
      plugins: [
        {
          name: 'observe-react-i18next',
          setup(buildApi) {
            buildApi.onResolve({ filter: /^react-i18next$/ }, args => {
              adapterResolutions += 1;
              return { external: true, path: args.path };
            });
          },
        },
      ],
      write: false,
    });

    expect(adapterResolutions).toBeGreaterThan(0);
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

  test('keeps expensive lifecycle helpers behind asynchronous bundle edges', async () => {
    const result = await build({
      bundle: true,
      entryPoints: [resolve(runtimeRoot, 'pluginSetup.ts')],
      format: 'esm',
      metafile: true,
      outdir: 'out',
      packages: 'external',
      platform: 'node',
      splitting: true,
      write: false,
    });

    const entryOutput = Object.values(result.metafile.outputs).find(output =>
      output.entryPoint?.endsWith('/pluginSetup.ts'),
    );
    if (!entryOutput) {
      throw new Error('pluginSetup entry output was not generated');
    }
    const dynamicOutputNames = entryOutput.imports
      .filter(moduleImport => moduleImport.kind === 'dynamic-import')
      .map(moduleImport => basename(moduleImport.path));
    const dynamicOutputs = Object.entries(result.metafile.outputs)
      .filter(([outputPath]) =>
        dynamicOutputNames.includes(basename(outputPath)),
      )
      .map(([, output]) => output);
    const dynamicEntries = dynamicOutputs.map(output =>
      basename(output.entryPoint ?? ''),
    );

    expect(dynamicEntries).toEqual(
      expect.arrayContaining(['middleware.ts', 'utils.ts']),
    );
  });

  test('registers plugin lifecycle hooks synchronously', () => {
    let beforeRender: unknown;
    let rootWrapper: unknown;
    const plugin = noReactI18nextPlugin({ reactI18next: false });
    const setupResult = plugin.setup?.({
      getRuntimeConfig: () => ({}),
      onBeforeRender: hook => {
        beforeRender = hook;
      },
      wrapRoot: wrapper => {
        rootWrapper = wrapper;
      },
    } as any);

    expect(setupResult).toBeUndefined();
    expect(typeof beforeRender).toBe('function');
    expect(typeof rootWrapper).toBe('function');
  });

  test('shares Modern i18n context across independently bundled runtime copies', async () => {
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
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
