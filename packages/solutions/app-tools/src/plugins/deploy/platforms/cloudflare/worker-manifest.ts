import path from 'node:path';
import { fs as fse } from '@modern-js/utils';
import { readRouteSpec } from './artifacts';
import {
  ASSETS_BINDING,
  BFF_EFFECT_WORKER_ENTRY,
  CLOUDFLARE_RUNTIME_TYPE,
  CLOUDFLARE_WORKER_BUNDLE_FORMAT,
  DEFAULT_SERVER_ONLY_PUBLIC_ASSET_EXCLUDES,
  EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE,
  LOADABLE_STATS_FILE,
  PUBLIC_ASSETS_DIRECTORY,
  ROUTE_MANIFEST_FILE,
  ROUTE_SPEC_FILE,
  ROUTE_SPEC_OUTPUT,
  SERVER_BUNDLE_DIRECTORY,
  WORKER_BUNDLE_DIRECTORY,
  WORKER_ENTRY,
} from './constants';
import type { DeliveryUnitStamp } from './delivery-unit';
import { createI18nWorkerManifest } from './i18n-worker';
import { createCloudflareWorkerSecurityPolicy } from './security-policies';
import type { CloudflareAppContext, CloudflareModernConfig } from './types';
import { normalizeRelativePath } from './utils';
import {
  createWorkerManifestServiceBindings,
  createWorkerServiceBindings,
} from './wrangler-config';

const createMissingEffectBffWorkerError = (
  outputDirectory: string,
  worker: string,
) =>
  new Error(
    `Cloudflare Effect API runtime is configured, but the BFF worker bundle is missing: ${path.join(
      outputDirectory,
      worker,
    )}. ${EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE}`,
  );

export const createWorkerManifest = async (
  outputDirectory: string,
  modernConfig: CloudflareModernConfig,
  appContext: CloudflareAppContext,
  deliveryUnitStamp: DeliveryUnitStamp | undefined,
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
  const isEffectApi =
    Boolean(modernConfig.bff) && modernConfig.bff?.runtimeFramework !== 'hono';
  const effectApiWorkerExists = await fse.pathExists(
    path.join(outputDirectory, BFF_EFFECT_WORKER_ENTRY),
  );
  const serviceBindings = createWorkerManifestServiceBindings(
    createWorkerServiceBindings(modernConfig, undefined),
  );

  if (isEffectApi && primaryBffPrefix && !effectApiWorkerExists) {
    throw createMissingEffectBffWorkerError(
      outputDirectory,
      BFF_EFFECT_WORKER_ENTRY,
    );
  }

  return {
    version: 1,
    runtime: {
      type: CLOUDFLARE_RUNTIME_TYPE,
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
      format: CLOUDFLARE_WORKER_BUNDLE_FORMAT,
      importableFromModuleWorker: true,
      requestHandlerExport: 'requestHandler',
    },
    resources: {
      loadableStats: LOADABLE_STATS_FILE,
      routeManifest: ROUTE_MANIFEST_FILE,
    },
    security: createCloudflareWorkerSecurityPolicy(modernConfig),
    ...(deliveryUnitStamp ? { deliveryUnit: deliveryUnitStamp } : {}),
    i18n: createI18nWorkerManifest(routeSpec, appContext),
    bff:
      isEffectApi && primaryBffPrefix && effectApiWorkerExists
        ? {
            runtimeFramework: 'effect',
            prefix: primaryBffPrefix,
            worker: BFF_EFFECT_WORKER_ENTRY,
          }
        : undefined,
    ...(serviceBindings === undefined ? {} : { serviceBindings }),
  };
};

export const createWorkerModuleLoaders = (manifest: any) => {
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

export const getPublicAssetExcludes = (
  appDirectory: string,
  modernConfig: CloudflareModernConfig,
) =>
  [
    ...DEFAULT_SERVER_ONLY_PUBLIC_ASSET_EXCLUDES.filter(directory => {
      try {
        return fse.statSync(path.join(appDirectory, directory)).isDirectory();
      } catch {
        return false;
      }
    }),
    ...(modernConfig.deploy?.worker?.publicAssetExcludes ?? []),
  ].map(entry =>
    normalizeRelativePath(entry, 'deploy.worker.publicAssetExcludes'),
  );

export const shouldCopyToPublicAssets = (
  src: string,
  distDirectory: string,
  publicAssetExcludes: string[],
) => {
  const relativePath = path.relative(distDirectory, src);

  if (!relativePath) {
    return true;
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const [topLevelDirectory] = normalizedRelativePath.split('/');
  const basename = normalizedRelativePath.split('/').pop() ?? '';

  return (
    normalizedRelativePath !== ROUTE_SPEC_FILE &&
    topLevelDirectory !== WORKER_BUNDLE_DIRECTORY &&
    topLevelDirectory !== SERVER_BUNDLE_DIRECTORY &&
    basename !== '.env' &&
    !basename.startsWith('.env.') &&
    !publicAssetExcludes.some(
      exclude =>
        normalizedRelativePath === exclude ||
        normalizedRelativePath.startsWith(`${exclude}/`),
    )
  );
};

export const shouldCopyToWorkerBundle = (
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

  if (fse.statSync(src).isDirectory()) {
    return true;
  }

  return ['.cjs', '.js', '.mjs'].includes(path.extname(normalizedRelativePath));
};
