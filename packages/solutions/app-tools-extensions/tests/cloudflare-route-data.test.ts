import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import * as dataLoaderRuntime from '@modern-js/plugin-data-loader/runtime';
import { createRsbuild, type EnvironmentConfig } from '@rsbuild/core';
import {
  createWorkerManifest,
  createWorkerModuleLoaders,
} from '../src/cloudflare/worker-manifest';
import { getCloudflareBuilderEnvironments } from '../src/cloudflare-builder';
import { getWorkerBundleReferences } from '../src/cloudflare-output-verifier/worker-bundles';
import { createRouteDataRequestHandler } from '../src/templates/cloudflare-worker-route-data.mjs';

// The loader module the SSR adapter registers for the client data transform.
const DATA_LOADER = createRequire(import.meta.url).resolve(
  '@modern-js/plugin-data-loader/loader',
);
const OTHER_LOADER = '/fixture/other-loader.js';

const createTempApp = () => {
  const appDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-cloudflare-route-data-'),
  );
  const internalDirectory = path.join(appDirectory, 'node_modules/.modern-js');
  fs.mkdirSync(path.join(internalDirectory, 'index'), { recursive: true });
  fs.writeFileSync(
    path.join(internalDirectory, 'index/server-loader-combined.js'),
    'export {};',
  );
  // An entry without SSR route data has no generated server loader module.
  fs.mkdirSync(path.join(internalDirectory, 'static'), { recursive: true });
  return {
    appContext: {
      apiDirectory: path.join(appDirectory, 'api'),
      appDirectory,
      entrypoints: [{ entryName: 'index' }, { entryName: 'static' }],
      internalDirectory,
    },
    dispose: () => fs.rmSync(appDirectory, { force: true, recursive: true }),
    internalDirectory,
  };
};

const getCloudflareEnvironments = (
  appContext: ReturnType<typeof createTempApp>['appContext'],
) =>
  getCloudflareBuilderEnvironments({
    appContext,
    environments: {
      client: { output: { target: 'web' } },
      workerSSR: {
        output: { target: 'web-worker' },
        source: { entry: { index: ['./src/bootstrap.jsx'] } },
      },
    } satisfies Record<string, EnvironmentConfig>,
    normalizedConfig: { deploy: { target: 'cloudflare' } },
  });

describe('Cloudflare worker route data', () => {
  it('bundles each generated server loader module as a route data worker entry', () => {
    const app = createTempApp();

    try {
      const environments = getCloudflareEnvironments(app.appContext);
      const routeDataModule = path.join(
        app.internalDirectory,
        'index/cloudflare-worker-route-data.js',
      );

      expect(environments.workerSSR?.source?.entry).toEqual({
        index: ['./src/index.server.jsx'],
        'index-server-loaders': [routeDataModule],
      });
      const source = fs.readFileSync(routeDataModule, 'utf-8');
      expect(source).toContain(
        "import * as serverLoaderModule from './server-loader-combined.js';",
      );
      expect(source).toContain('cloudflare-worker-route-data.mjs');
      expect(source).toContain(
        'export const handleRouteDataRequest =\n  createRouteDataRequestHandler(serverLoaderModule);',
      );
    } finally {
      app.dispose();
    }
  });

  it('keeps route loaders in-process in the worker while clients still fetch them', async () => {
    const app = createTempApp();

    try {
      const rsbuild = await createRsbuild({
        cwd: app.appContext.appDirectory,
        config: { environments: getCloudflareEnvironments(app.appContext) },
      });
      // Mirrors the SSR adapter, which registers the client data loader
      // transform for every environment before environment bundler chains run.
      // The rule is found by its loader module, so a renamed rule is removed
      // too, while unrelated rules stay.
      rsbuild.addPlugins([
        {
          name: 'fixture-ssr-data-loader',
          setup(api) {
            api.modifyBundlerChain(chain => {
              for (const rule of ['ssr-data-loader', 'renamed-data-loader']) {
                chain.module
                  .rule(rule)
                  .test(/\.data\.[jt]sx?$/u)
                  .use('data-loader')
                  .loader(DATA_LOADER);
              }
              chain.module
                .rule('other')
                .test(/\.other$/u)
                .use('other')
                .loader(OTHER_LOADER);
            });
          },
        },
      ]);
      const rspackConfigs = await rsbuild.initConfigs();
      const rules = (name: string) =>
        JSON.stringify(
          rspackConfigs.find(config => config.name === name)?.module?.rules,
        );
      const dataLoaderUses = (name: string) =>
        rules(name).split(JSON.stringify(DATA_LOADER)).length - 1;

      expect(dataLoaderUses('client')).toBe(2);
      expect(dataLoaderUses('workerSSR')).toBe(0);
      expect(rules('workerSSR')).toContain(OTHER_LOADER);
    } finally {
      app.dispose();
    }
  });

  it('publishes the route data worker in the manifest and module loaders', async () => {
    const outputDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-route-data-output-'),
    );

    try {
      fs.mkdirSync(path.join(outputDirectory, 'server'), { recursive: true });
      fs.mkdirSync(path.join(outputDirectory, 'worker'), { recursive: true });
      fs.writeFileSync(
        path.join(outputDirectory, 'server/route.json'),
        JSON.stringify({
          routes: [
            {
              urlPath: '/',
              entryName: 'index',
              entryPath: 'index.html',
              isSSR: true,
              worker: 'worker/index.js',
            },
            {
              urlPath: '/static',
              entryName: 'static',
              entryPath: 'static.html',
              isSSR: true,
              worker: 'worker/static.js',
            },
          ],
        }),
      );
      for (const worker of [
        'index.js',
        'index-server-loaders.js',
        'static.js',
      ]) {
        fs.writeFileSync(path.join(outputDirectory, 'worker', worker), '');
      }

      const manifest = await createWorkerManifest(
        outputDirectory,
        {},
        {
          apiOnly: false,
          appDirectory: outputDirectory,
          distDirectory: outputDirectory,
          serverPlugins: [],
        },
        undefined,
      );

      expect(manifest.routeSpec.routes).toEqual([
        expect.objectContaining({
          entryName: 'index',
          routeDataWorker: 'worker/index-server-loaders.js',
        }),
        expect.not.objectContaining({ routeDataWorker: expect.anything() }),
      ]);
      expect(createWorkerModuleLoaders(manifest)).toContain(
        '"worker/index-server-loaders.js": () => import("../worker/index-server-loaders.js")',
      );
      expect(getWorkerBundleReferences(manifest)).toContainEqual({
        dispatcherExport: 'handleRouteDataRequest',
        kind: 'route-data',
        reference: 'worker/index-server-loaders.js',
      });
    } finally {
      fs.rmSync(outputDirectory, { force: true, recursive: true });
    }
  });

  it('answers route data requests like the Node data handler, including localized URLs', async () => {
    const pages: Record<string, string> = { about: 'About' };
    const loader = ({ params }: { params: Record<string, string> }) =>
      pages[params.page] === undefined
        ? new Response(null, { status: 404 })
        : { lang: params.lang, title: pages[params.page] };
    const handleRouteDataRequest = createRouteDataRequestHandler({
      // Async entries load the data loader runtime and route loaders lazily.
      loadModules: async () => ({
        ...dataLoaderRuntime,
        routes: [
          { type: 'nested', id: 'page', path: ':lang/:page', loader },
          {
            type: 'nested',
            id: 'page__localised_lang_o-mne',
            path: ':lang/o-mne',
            loader: () => loader({ params: { lang: 'cs', page: 'about' } }),
            modernLocalisedRoute: { id: 'page' },
            modernCanonicalPath: '/:page',
          },
        ],
      }),
    });
    const serverRoutes = [
      {
        urlPath: '/',
        entryName: 'index',
        entryPath: 'index.html',
        isSSR: true,
      },
    ];
    const load = (pathname: string) =>
      handleRouteDataRequest({
        request: new Request(
          `https://example.test${pathname}?__loader=page&__ssrDirect=true`,
        ),
        serverRoutes,
      });

    const canonical = await load('/en/about');
    expect(canonical.status).toBe(200);
    expect(canonical.headers.get('X-Modernjs-Response')).toBe('yes');
    expect(await canonical.json()).toEqual({ lang: 'en', title: 'About' });

    const localised = await load('/cs/o-mne');
    expect(localised.status).toBe(200);
    expect(await localised.json()).toEqual({ lang: 'cs', title: 'About' });

    const missing = await load('/en/missing');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('X-Modernjs-Response')).toBe('yes');
  });
});
