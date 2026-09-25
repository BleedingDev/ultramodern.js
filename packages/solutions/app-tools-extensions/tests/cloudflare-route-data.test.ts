import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createRsbuild, type EnvironmentConfig } from '@rsbuild/core';
import {
  createWorkerManifest,
  createWorkerModuleLoaders,
} from '../src/cloudflare/worker-manifest';
import { getCloudflareBuilderEnvironments } from '../src/cloudflare-builder';
import { getWorkerBundleReferences } from '../src/cloudflare-output-verifier/worker-bundles';

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
  const writeEntryFiles = (entryName: string, files: string[]) => {
    fs.mkdirSync(path.join(internalDirectory, entryName), { recursive: true });
    for (const file of files) {
      fs.writeFileSync(path.join(internalDirectory, entryName, file), '');
    }
  };
  writeEntryFiles('index', [
    'server-loader-combined.js',
    'route-server-loaders.js',
  ]);
  // An entry without SSR route data has no generated server loader module.
  writeEntryFiles('static', ['route-server-loaders.js']);
  // Entries that keep route loaders out of the SSR bundle have a loader
  // bundle without route loaders.
  writeEntryFiles('rsc', ['server-loader-combined.js']);
  return {
    appContext: {
      apiDirectory: path.join(appDirectory, 'api'),
      appDirectory,
      entrypoints: [
        { entryName: 'index' },
        { entryName: 'static' },
        { entryName: 'rsc' },
      ],
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
  it('bundles the route loaders of each loader bundle entry as a route data worker entry', () => {
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
      // The loader bundle re-exports the react-router based data loader
      // runtime, so the worker imports only the route loaders.
      expect(source).toContain(
        "import { routes } from './route-server-loaders.js';",
      );
      expect(source).not.toContain('server-loader-combined');
      expect(source).toContain('cloudflare-worker-route-data.mjs');
      expect(source).toContain(
        'export const handleRouteDataRequest =\n  createRouteDataRequestHandler(routes);',
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
});
