import path from 'node:path';
import { fs as fse } from '@modern-js/utils';
import { readTemplate } from '../utils';
import type { CreatePreset } from './platform';

const WORKER_ENTRY = 'server/index.mjs';
const WORKER_MANIFEST = 'server/modern-worker-manifest.json';
const ASSETS_BINDING = 'ASSETS';
const ROUTE_SPEC_FILE = 'route.json';
const ROUTE_SPEC_OUTPUT = `server/${ROUTE_SPEC_FILE}`;
const LOADABLE_STATS_FILE = 'loadable-stats.json';
const ROUTE_MANIFEST_FILE = 'routes-manifest.json';
const PUBLIC_ASSETS_DIRECTORY = 'public';
const WORKER_BUNDLE_DIRECTORY = 'worker';
const SERVER_BUNDLE_DIRECTORY = 'bundles';
const BFF_EFFECT_WORKER_ENTRY = `${WORKER_BUNDLE_DIRECTORY}/__modern_bff_effect.js`;

const getCompatibilityDate = () => new Date().toISOString().slice(0, 10);

const getWorkerName = (appDirectory: string) => {
  const basename = path.basename(appDirectory);
  return basename.replace(/[^a-zA-Z0-9-_]/g, '-') || 'modern-cloudflare-worker';
};

const getConfiguredWorkerName = (
  appDirectory: string,
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  const configuredName = modernConfig.deploy?.worker?.name?.trim();
  return configuredName || getWorkerName(appDirectory);
};

const readRouteSpec = async (outputDirectory: string) => {
  const routeSpecPath = path.join(outputDirectory, ROUTE_SPEC_OUTPUT);

  if (!(await fse.pathExists(routeSpecPath))) {
    return { routes: [] };
  }

  const routeSpec = await fse.readJSON(routeSpecPath);

  return {
    ...routeSpec,
    routes: Array.isArray(routeSpec.routes) ? routeSpec.routes : [],
  };
};

const createWorkerManifest = async (
  outputDirectory: string,
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  const routeSpec = await readRouteSpec(outputDirectory);
  const routes = await Promise.all(
    routeSpec.routes.map(async (route: Record<string, any>) => {
      const worker =
        typeof route.worker === 'string' ? route.worker : undefined;

      return {
        urlPath: route.urlPath,
        entryName: route.entryName,
        entryPath: route.entryPath,
        isSSR: Boolean(route.isSSR),
        worker,
        workerExists: worker
          ? await fse.pathExists(path.join(outputDirectory, worker))
          : false,
      };
    }),
  );

  const bffPrefix = modernConfig.bff?.prefix;
  const primaryBffPrefix = Array.isArray(bffPrefix) ? bffPrefix[0] : bffPrefix;
  const isEffectBff =
    Boolean(modernConfig.bff) && modernConfig.bff?.runtimeFramework !== 'hono';
  const effectBffWorkerExists = await fse.pathExists(
    path.join(outputDirectory, BFF_EFFECT_WORKER_ENTRY),
  );

  return {
    version: 1,
    runtime: {
      type: 'cloudflare-module-worker',
      entry: WORKER_ENTRY,
      fetchExport: true,
      nodeListen: false,
    },
    assets: {
      binding: ASSETS_BINDING,
      directory: `./${PUBLIC_ASSETS_DIRECTORY}`,
      runWorkerFirst: true,
    },
    routeSpec: {
      file: ROUTE_SPEC_OUTPUT,
      routes,
    },
    workerBundles: {
      directory: WORKER_BUNDLE_DIRECTORY,
      format: 'esm',
      importableFromModuleWorker: true,
      requestHandlerExport: 'requestHandler',
    },
    resources: {
      loadableStats: LOADABLE_STATS_FILE,
      routeManifest: ROUTE_MANIFEST_FILE,
    },
    bff:
      isEffectBff && primaryBffPrefix && effectBffWorkerExists
        ? {
            runtimeFramework: 'effect',
            prefix: primaryBffPrefix,
            worker: BFF_EFFECT_WORKER_ENTRY,
          }
        : undefined,
  };
};

const createWorkerModuleLoaders = (manifest: any) => {
  const imports = new Map<string, string>();

  for (const route of manifest.routeSpec.routes) {
    if (route.worker && route.workerExists) {
      const importPath = `../${String(route.worker).replace(/^\/+/u, '')}`;
      imports.set(route.worker, `() => import(${JSON.stringify(importPath)})`);
    }
  }

  if (manifest.bff?.worker) {
    const importPath = `../${String(manifest.bff.worker).replace(/^\/+/u, '')}`;
    imports.set(
      manifest.bff.worker,
      `() => import(${JSON.stringify(importPath)})`,
    );
  }

  if (imports.size === 0) {
    return '{}';
  }

  const loaders = [...imports.entries()].map(
    ([worker, loader]) => `${JSON.stringify(worker)}: ${loader}`,
  );

  return `{\n${loaders.join(',\n')}\n}`;
};

const shouldCopyToPublicAssets = (src: string, distDirectory: string) => {
  const relativePath = path.relative(distDirectory, src);

  if (!relativePath) {
    return true;
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const [topLevelDirectory] = normalizedRelativePath.split('/');

  return (
    normalizedRelativePath !== ROUTE_SPEC_FILE &&
    topLevelDirectory !== WORKER_BUNDLE_DIRECTORY &&
    topLevelDirectory !== SERVER_BUNDLE_DIRECTORY
  );
};

const shouldCopyToWorkerBundle = (
  src: string,
  workerBundleDirectory: string,
) => {
  const relativePath = path.relative(workerBundleDirectory, src);

  if (!relativePath) {
    return true;
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const basename = path.basename(normalizedRelativePath);

  if (basename.startsWith('.') || normalizedRelativePath.includes('/.')) {
    return false;
  }

  return ['.cjs', '.js', '.mjs'].includes(path.extname(normalizedRelativePath));
};

export const createCloudflarePreset: CreatePreset = ({
  appContext,
  modernConfig,
}) => {
  const { appDirectory, distDirectory } = appContext;

  const outputDirectory = path.join(appDirectory, '.output');
  const publicDirectory = path.join(outputDirectory, PUBLIC_ASSETS_DIRECTORY);
  const workerEntryPath = path.join(outputDirectory, WORKER_ENTRY);
  const workerManifestPath = path.join(outputDirectory, WORKER_MANIFEST);
  const routeSpecOutputPath = path.join(outputDirectory, ROUTE_SPEC_OUTPUT);
  const wranglerConfigPath = path.join(outputDirectory, 'wrangler.json');
  const workerName = getConfiguredWorkerName(appDirectory, modernConfig);

  return {
    async prepare() {
      await fse.remove(outputDirectory);
    },
    async writeOutput() {
      await fse.copy(distDirectory, publicDirectory, {
        filter: src => shouldCopyToPublicAssets(src, distDirectory),
      });
      await fse.ensureDir(path.dirname(workerEntryPath));
      await fse.ensureDir(path.dirname(workerManifestPath));

      const routeSpecSourcePath = path.join(distDirectory, ROUTE_SPEC_FILE);
      if (await fse.pathExists(routeSpecSourcePath)) {
        await fse.copy(routeSpecSourcePath, routeSpecOutputPath);
      }

      const workerBundleSourceDirectory = path.join(
        distDirectory,
        WORKER_BUNDLE_DIRECTORY,
      );
      if (await fse.pathExists(workerBundleSourceDirectory)) {
        await fse.copy(
          workerBundleSourceDirectory,
          path.join(outputDirectory, WORKER_BUNDLE_DIRECTORY),
          {
            filter: src =>
              shouldCopyToWorkerBundle(src, workerBundleSourceDirectory),
          },
        );
      }

      await fse.writeJSON(
        wranglerConfigPath,
        {
          $schema: 'node_modules/wrangler/config-schema.json',
          name: workerName,
          main: WORKER_ENTRY,
          compatibility_date: getCompatibilityDate(),
          compatibility_flags: ['nodejs_compat'],
          assets: {
            directory: `./${PUBLIC_ASSETS_DIRECTORY}`,
            binding: ASSETS_BINDING,
            run_worker_first: true,
          },
        },
        {
          spaces: 2,
        },
      );

      await fse.writeJSON(
        workerManifestPath,
        await createWorkerManifest(outputDirectory, modernConfig),
        {
          spaces: 2,
        },
      );
      await fse.writeJSON(path.join(outputDirectory, 'package.json'), {
        type: 'module',
      });
    },
    async genEntry() {
      const template = await readTemplate('cloudflare-entry.mjs');
      const manifest = await fse.readJSON(workerManifestPath);

      await fse.writeFile(
        workerEntryPath,
        template
          .replace('p_workerManifest', JSON.stringify(manifest, null, 2))
          .replace(
            'p_workerModuleLoaders',
            createWorkerModuleLoaders(manifest),
          ),
      );
    },
  };
};
