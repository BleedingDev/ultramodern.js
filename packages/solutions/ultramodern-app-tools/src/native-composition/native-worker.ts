import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NATIVE_RENDERER_WORKER_RESOURCES_FILE,
  type NativeRendererWorkerEntry,
  type NativeRendererWorkerResources,
} from '@modern-js/app-tools-extensions/cloudflare/native-renderer';
import { applyCloudflareWorkerRspackConfig } from '@modern-js/app-tools-extensions/cloudflare-builder';
import { resolveDeployTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import type { Renderer, RendererIdentity } from '@modern-js/renderer-core';
import type { NativeCompilerArtifacts } from '@modern-js/renderer-core/adapter';
import {
  RENDERER_ASSET_MANIFEST_FILE,
  validateNativeClientAssetManifest,
} from '@modern-js/renderer-core/server';
import {
  getEntryOptions,
  SERVER_WORKER_BUNDLE_DIRECTORY,
} from '@modern-js/utils';
import { cutNameByHyphen } from '@modern-js/utils/universal';
import type { EnvironmentConfig, ModifyBundlerChainFn } from '@rsbuild/core';

export interface NativeWorkerConfig {
  deploy?: { target?: string; worker?: { ssr?: boolean } };
  server?: {
    ssr?: unknown;
    ssrByEntries?: Record<string, unknown>;
    ssrByRouteIds?: string[];
  };
  security?: { nonce?: string };
}

/** Native Cloudflare SSR builds the same server handler as a module worker. */
export const isNativeWorkerBuild = (config: NativeWorkerConfig): boolean =>
  resolveDeployTarget({ configTarget: config.deploy?.target }).target ===
    'cloudflare' && Boolean(config.deploy?.worker?.ssr);

/** The worker entry re-exports the native handler and its Fetch dispatcher. */
export const nativeWorkerEntrySource = (serverEntry: string): string =>
  `export * from ${JSON.stringify(serverEntry)};
export { dispatchNativeWorkerRequest } from '@modern-js/renderer-core/server';
`;

/**
 * Build the native worker entries as the same `web` module bundle the
 * Cloudflare React worker uses. Native compilers select their server
 * transform from the `workerSSR` environment name.
 */
export function nativeWorkerEnvironment(
  environment: EnvironmentConfig,
  entries: Record<string, string>,
): EnvironmentConfig {
  const configured = environment.source?.entry ?? {};
  // Keep framework worker entries, such as the Effect BFF worker, and replace
  // only page entries with their native worker modules.
  const entry = {
    ...Object.fromEntries(
      Object.entries(configured).filter(([name]) => !(name in entries)),
    ),
    ...entries,
  };
  const chain: ModifyBundlerChainFn = bundlerChain => {
    applyCloudflareWorkerRspackConfig(bundlerChain, Object.keys(entry));
    bundlerChain.output
      .module(true)
      .library({ type: 'module' })
      .publicPath('/')
      .chunkFormat('module')
      .chunkLoading('import')
      .workerChunkLoading('import');
    for (const condition of ['workerd', 'worker', 'import', 'module'])
      bundlerChain.resolve.conditionNames.add(condition);
  };
  const bundlerChains = environment.tools?.bundlerChain;
  return {
    ...environment,
    source: { ...environment.source, entry },
    output: { ...environment.output, module: true, target: 'web' },
    tools: {
      ...environment.tools,
      htmlPlugin: false,
      bundlerChain: [
        chain,
        ...(bundlerChains
          ? Array.isArray(bundlerChains)
            ? bundlerChains
            : [bundlerChains]
          : []),
      ],
    },
  };
}

function serverConfig(
  config: NativeWorkerConfig,
  entryName: string,
): Pick<NativeRendererWorkerEntry, 'serverConfig'> & { csrFallback: boolean } {
  const ssr = getEntryOptions(
    entryName,
    false,
    config.server?.ssr as never,
    config.server?.ssrByEntries as never,
  ) as unknown;
  return {
    serverConfig: {
      ssr: !ssr
        ? false
        : typeof ssr === 'object' &&
            (ssr as { mode?: string }).mode === 'stream'
          ? 'stream'
          : true,
      ...(config.server?.ssrByRouteIds
        ? { ssrByRouteIds: [...config.server.ssrByRouteIds] }
        : {}),
    },
    csrFallback: Boolean(
      typeof ssr === 'object' && (ssr as { forceCSR?: boolean }).forceCSR,
    ),
  };
}

/**
 * Validate the completed client artifacts exactly as the Node host does at
 * request time, then write them beside the worker bundles for deploy.
 */
export async function writeNativeWorkerResources(options: {
  renderer: Exclude<Renderer, 'react'>;
  distDirectory: string;
  clientOutputDirectory: string;
  metaName: string;
  config: NativeWorkerConfig;
  identities: Readonly<Record<string, RendererIdentity>>;
  compilerArtifacts: NativeCompilerArtifacts;
  workerEntryFiles: Readonly<Record<string, readonly string[]>>;
}): Promise<void> {
  const assetManifest = JSON.parse(
    await fs.readFile(
      path.join(options.distDirectory, RENDERER_ASSET_MANIFEST_FILE),
      'utf8',
    ),
  );
  const fallbackHeader = `x-${cutNameByHyphen(options.metaName || 'modern-js')}-ssr-fallback`;
  const entries: Record<string, NativeRendererWorkerEntry> = {};
  for (const [entryName, identity] of Object.entries(options.identities)) {
    const files = options.workerEntryFiles[entryName] ?? [];
    if (
      files.length !== 1 ||
      files[0] !== `${SERVER_WORKER_BUNDLE_DIRECTORY}/${entryName}.js`
    )
      throw new Error(
        `Native worker entry ${entryName} must emit exactly ${SERVER_WORKER_BUNDLE_DIRECTORY}/${entryName}.js`,
      );
    const assets = validateNativeClientAssetManifest(assetManifest, identity);
    const validated = await options.compilerArtifacts.validateClientManifest(
      JSON.parse(
        await fs.readFile(
          path.join(
            options.clientOutputDirectory,
            options.compilerArtifacts.clientManifestFile(entryName),
          ),
          'utf8',
        ),
      ),
      identity,
      { development: false },
    );
    const { serverConfig: entryServerConfig, csrFallback } = serverConfig(
      options.config,
      entryName,
    );
    entries[entryName] = {
      assets,
      nativeManifest: validated.nativeManifest,
      ...(validated.hydrationBuildId === undefined
        ? {}
        : { hydrationBuildId: validated.hydrationBuildId }),
      serverConfig: entryServerConfig,
      ...(csrFallback ? { csrFallbackHeader: fallbackHeader } : {}),
      ...(options.config.security?.nonce
        ? { nonce: options.config.security.nonce }
        : {}),
    };
  }
  const resources: NativeRendererWorkerResources = {
    schema: 'ultramodern-native-worker-resources',
    version: 1,
    renderer: options.renderer,
    entries,
  };
  const output = path.join(
    options.distDirectory,
    NATIVE_RENDERER_WORKER_RESOURCES_FILE,
  );
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(resources));
}
