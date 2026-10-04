import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import { resolveDeployTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import { type Renderer, resolveRenderer } from '@modern-js/renderer-core';
import type { RsbuildPlugin, RsbuildPlugins } from '@rsbuild/core';
import { resolveRendererRegistration } from './renderer-registration';
import type { UltramodernAppUserConfig } from './types';

export const ULTRAMODERN_BASE_PLUGIN = '@modern-js/ultramodern-app-tools';
const compilerClaim = Symbol.for('ultramodern.renderer-compiler-claim');

export interface RendererCompilerClaim {
  readonly renderer: Exclude<Renderer, 'react'>;
  readonly sourceExtensions: readonly string[];
  readonly transform: 'native';
  readonly refresh: 'native';
  readonly svg: 'url';
}

type ClaimedPlugin = RsbuildPlugin & {
  [compilerClaim]?: RendererCompilerClaim;
};

/** A compiler owns JSX, refresh and SVG policy together, before Rsbuild setup. */
export function attachRendererCompilerClaim<T extends RsbuildPlugin>(
  plugin: T,
  claim: RendererCompilerClaim,
): T {
  resolveRenderer(claim.renderer);
  if (
    resolveRendererRegistration(claim.renderer).kind !== 'native' ||
    claim.transform !== 'native' ||
    claim.refresh !== 'native' ||
    claim.svg !== 'url' ||
    claim.sourceExtensions.length === 0 ||
    claim.sourceExtensions.some(extension => !/^\.[a-z]+$/u.test(extension))
  ) {
    throw new Error('Invalid native renderer compiler ownership claim');
  }
  if ((plugin as ClaimedPlugin)[compilerClaim]) {
    throw new Error(`Compiler ${plugin.name} already owns a source transform`);
  }
  Object.defineProperty(plugin, compilerClaim, {
    value: Object.freeze({
      ...claim,
      sourceExtensions: Object.freeze([...claim.sourceExtensions]),
    }),
    enumerable: true,
  });
  return plugin;
}

export function assertRendererCompilerOwnership(
  renderer: Renderer,
  plugins: readonly RsbuildPlugin[],
): RendererCompilerClaim | undefined {
  const claims = plugins.flatMap(plugin => {
    const claim = (plugin as ClaimedPlugin)[compilerClaim];
    return claim ? [claim] : [];
  });
  if (resolveRendererRegistration(renderer).kind !== 'native') {
    if (claims.length) {
      throw new Error('React configuration contains a native compiler owner');
    }
    return undefined;
  }
  if (claims.length !== 1 || claims[0].renderer !== renderer) {
    throw new Error(
      `Renderer ${renderer} requires exactly one matching native compiler owner`,
    );
  }
  return claims[0];
}

/** Resolve the same arrays, promises and disabled values accepted by Rsbuild. */
export async function resolveRendererBuilderPlugins(
  plugins: RsbuildPlugins,
): Promise<RsbuildPlugin[]> {
  const resolved: RsbuildPlugin[] = [];
  for (const candidate of plugins) {
    const plugin = await candidate;
    if (!plugin) continue;
    if (Array.isArray(plugin)) {
      resolved.push(...(await resolveRendererBuilderPlugins(plugin)));
    } else {
      resolved.push(plugin);
    }
  }
  return resolved;
}

export const REACT_CLI_PLUGIN_NAMES = [
  '@modern-js/runtime',
  '@modern-js/plugin-ssr',
  '@modern-js/plugin-router',
  '@modern-js/plugin-document',
  '@modern-js/ultramodern-router-integration',
  '@modern-js/ultramodern-ssr-integration',
  '@modern-js/ultramodern-i18n-integration',
  '@modern-js/i18n-integration',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/plugin-module-federation',
] as const;

const basePluginNames = new Set([
  ULTRAMODERN_BASE_PLUGIN,
  '@modern-js/app-tools',
]);

export function assertNoAdditionalBasePlugins(
  plugins: readonly CliPlugin<AppTools>[],
): void {
  const visit = (plugin: CliPlugin<AppTools>) => {
    if (basePluginNames.has(plugin.name)) {
      throw new Error(
        'defineConfig owns the UltraModern base composition; remove the additional base plugin',
      );
    }
    for (const child of plugin.usePlugins ?? []) visit(child);
  };
  for (const plugin of plugins) visit(plugin);
}

function assertNativeExternalScripts(
  renderer: Renderer,
  output:
    | { inlineScripts?: unknown; disableInlineRuntimeChunk?: boolean }
    | undefined,
): void {
  if (
    (output?.inlineScripts !== undefined && output.inlineScripts !== false) ||
    (output?.disableInlineRuntimeChunk === false &&
      output.inlineScripts !== false)
  )
    throw new Error(
      `unsupported-renderer-capability: renderer ${renderer} requires external script assets; script inlining is not supported by native documents`,
    );
}

export function assertCapturedRenderer(
  config: UltramodernAppUserConfig,
  renderer: Renderer,
): void {
  const registration = resolveRendererRegistration(config.renderer);
  const actual = registration.renderer;
  if (actual !== renderer) {
    throw new Error(
      `Renderer changed from ${renderer} to ${actual} after plugin selection. Update the source configuration and restart the dev server.`,
    );
  }
  if (registration.kind === 'native')
    assertNativeExternalScripts(renderer, config.output);
  const capabilities = registration.candidateProfile.capabilities;
  const reject = (capability: string): never => {
    throw new Error(
      `unsupported-renderer-capability: renderer ${renderer} does not support ${capability}`,
    );
  };
  if (!capabilities.rsc && config.server?.rsc)
    reject('React Server Components');
  const selected = config as UltramodernAppUserConfig & {
    runtime?: { i18n?: unknown };
    i18n?: unknown;
    moduleFederation?: unknown;
  };
  if (!capabilities.i18n && (selected.runtime?.i18n || selected.i18n))
    reject('React i18n integration');
  if (
    !capabilities.ssg &&
    (config.output?.ssg ||
      Object.values(config.output?.ssgByEntries ?? {}).some(Boolean))
  )
    reject('static site generation');
  if (
    !capabilities.svgComponent &&
    config.output?.svgDefaultExport === 'component'
  )
    reject('SVG components; import SVG URLs instead');
  if (
    !registration.supports.cssDeclarations &&
    config.output?.enableCssModuleTSDeclaration
  )
    reject('CSS declaration generation beside authored source');
  if (!registration.supports.reactCompiler && config.source?.reactCompiler)
    reject('the React compiler');
  if (
    !capabilities.moduleFederation &&
    (selected.moduleFederation ||
      (typeof config.server?.ssr === 'object' &&
        config.server.ssr.moduleFederationAppSSR) ||
      Object.values(config.server?.ssrByEntries ?? {}).some(
        value =>
          value &&
          typeof value === 'object' &&
          'moduleFederationAppSSR' in value &&
          value.moduleFederationAppSSR,
      ))
  )
    reject('Module Federation application SSR');
  if (
    !capabilities.worker &&
    (config.deploy?.worker?.ssr || resolveDeployTarget(config) !== 'node')
  )
    reject('worker or unadmitted deployment providers');
}

function flattenPluginNames(plugins: readonly CliPlugin<AppTools>[]): string[] {
  return plugins.flatMap(plugin => [
    plugin.name,
    ...flattenPluginNames(plugin.usePlugins ?? []),
  ]);
}

export function rendererSelectionGuard(
  renderer: Renderer,
  selectedPlugins: readonly CliPlugin<AppTools>[],
  consumerPlugins: readonly CliPlugin<AppTools>[] = [],
  verifyCompilerOwnership = false,
): CliPlugin<AppTools> {
  return {
    name: '@modern-js/renderer-selection',
    // In the actual manager `post` means these plugins run after this guard.
    post: [
      ...new Set([
        ...flattenPluginNames(selectedPlugins),
        ...flattenPluginNames(consumerPlugins),
        ...REACT_CLI_PLUGIN_NAMES,
      ]),
    ],
    setup(api) {
      const validate = (config: UltramodernAppUserConfig) => {
        assertCapturedRenderer(config, renderer);
        const bases = (config.plugins ?? []).filter(
          plugin => plugin.name === ULTRAMODERN_BASE_PLUGIN,
        );
        if (bases.length !== 1) {
          throw new Error(
            'Exactly one UltraModern base composition is required',
          );
        }
        assertNoAdditionalBasePlugins(
          (config.plugins ?? []).filter(plugin => plugin !== bases[0]),
        );
      };
      validate(api.getConfig() as UltramodernAppUserConfig);
      if (!resolveRendererRegistration(renderer).supports.reactCliPlugins) {
        const forbidden = api
          .getAppContext()
          .plugins.filter(plugin =>
            REACT_CLI_PLUGIN_NAMES.includes(
              plugin.name as (typeof REACT_CLI_PLUGIN_NAMES)[number],
            ),
          );
        if (forbidden.length) {
          throw new Error(
            `Renderer ${renderer} cannot register React CLI plugins: ${forbidden.map(plugin => plugin.name).join(', ')}. Use the UltraModern CLI entry.`,
          );
        }
      }
      api.modifyResolvedConfig(config => {
        validate(config as UltramodernAppUserConfig);
        if (resolveRendererRegistration(renderer).kind !== 'native')
          return config;
        return {
          ...config,
          output: {
            ...config.output,
            // The builder captures this flag before its runtime-inline default.
            disableInlineRuntimeChunk:
              config.output?.disableInlineRuntimeChunk ?? true,
          },
        };
      });
      // Catch a later consumer transform before app-tools starts output work.
      api.onPrepare(async () => {
        const config = api.getNormalizedConfig() as UltramodernAppUserConfig;
        validate(config);
        if (verifyCompilerOwnership) {
          assertRendererCompilerOwnership(
            renderer,
            await resolveRendererBuilderPlugins(config.builderPlugins ?? []),
          );
        }
      });
    },
  };
}

/** Global removal runs before Rsbuild initializes any listed React plugin. */
export function nativeRendererIsolationPlugin(
  renderer: Exclude<Renderer, 'react'>,
): RsbuildPlugin {
  return {
    name: `ultramodern:${renderer}:isolation`,
    remove: [
      'rsbuild:react',
      'rsbuild:svgr',
      'builder-plugin-adapter-modern-ssr',
    ],
    setup(api) {
      api.modifyBundlerChain({
        order: 'post',
        handler(_chain, { environment }) {
          // Inspect final environment policy, including tools.rsbuild changes.
          assertNativeExternalScripts(renderer, environment.config.output);
        },
      });
    },
  };
}
