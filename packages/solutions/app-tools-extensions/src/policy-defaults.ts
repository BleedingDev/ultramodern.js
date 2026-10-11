import {
  collectRuntimePackageModuleDirectories,
  createRuntimePackageResolutionPlugin,
} from './runtime-package-resolution';

/**
 * The fork's renderer policy (head rendering, HTML template assembly and asset
 * ordering) and server policy (localised loaders, error responses, telemetry,
 * module-federation CSS and asset cache headers, static serving) are the
 * default behaviour of an UltraModern.js app.
 *
 * They live in their own packages so they can also be composed explicitly, but
 * a plain `appTools()` app gets them without opting in — that is what this fork
 * has always done. Pass `appTools({ rendererExtensions: false })` or
 * `appTools({ serverExtensions: false })` to run without them.
 */
export const RENDERER_EXTENSIONS_PACKAGE =
  '@modern-js/runtime-renderer-extensions';

export const RENDERER_EXTENSIONS_PLUGIN_NAME = 'rendererHead';

export const SERVER_EXTENSIONS_PLUGIN_NAME =
  '@modern-js/app-tools/server-plugin';

export const ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME =
  '@modern-js/ultramodern-app-tools/server-plugin';

export interface PolicyDefaultsOptions {
  /** Default `true`. Set to `false` to drop the fork's renderer policy. */
  rendererExtensions?: boolean;
  /** Default `true`. Set to `false` to drop the fork's server policy. */
  serverExtensions?: boolean;
}

/** The native package that explicitly composes the policy. */
export interface PolicyDefaultsComposition {
  pluginName?: string;
  serverPluginName?: string;
  /** Additional runtime packages that share the resolution fallback. */
  runtimePackages?: readonly string[];
  /** Resolve runtime packages from the composing package. */
  registrarUrl?: string;
}

type RuntimePluginDescriptor = {
  name?: string;
  path: string;
  config?: unknown;
};

type ServerPluginDescriptor = { name: string };

/**
 * The subset of the CLI plugin API these defaults use. Typed structurally, and
 * loosely at the hook boundary, so this package stays free of a dependency on
 * the solution that consumes it — which depends on this one.
 */
export interface PolicyDefaultsPluginApi {
  _internalRuntimePlugins(fn: (input: any) => any): void;
  _internalServerPlugins(fn: (input: any) => any): void;
  modifyResolvedConfig(fn: (config: any) => any): void;
}

type RuntimePluginsInput = {
  entrypoint: unknown;
  plugins: RuntimePluginDescriptor[];
};

type ServerPluginsInput = { plugins: ServerPluginDescriptor[] };

export const POLICY_DEFAULTS_PLUGIN_NAME =
  '@modern-js/ultramodern-policy-defaults';

/** Registers the fork's default renderer and server policy. */
export const applyPolicyDefaults = (
  api: PolicyDefaultsPluginApi,
  options: PolicyDefaultsOptions = {},
  composition: PolicyDefaultsComposition = {},
): void => {
  if (options.rendererExtensions !== false) {
    api._internalRuntimePlugins(
      ({ entrypoint, plugins }: RuntimePluginsInput) => {
        // An explicit composition (`ultramodernAppTools()`) may already have
        // registered it; the descriptor list must stay free of duplicates.
        if (
          !plugins.some(plugin => plugin.path === RENDERER_EXTENSIONS_PACKAGE)
        ) {
          plugins.push({
            name: RENDERER_EXTENSIONS_PLUGIN_NAME,
            path: RENDERER_EXTENSIONS_PACKAGE,
            config: {},
          });
        }
        return { entrypoint, plugins };
      },
    );
  }

  const runtimePackages = [
    ...(options.rendererExtensions !== false
      ? [RENDERER_EXTENSIONS_PACKAGE]
      : []),
    ...(composition.runtimePackages ?? []).filter(
      packageName => packageName !== RENDERER_EXTENSIONS_PACKAGE,
    ),
  ];
  const moduleDirectories = collectRuntimePackageModuleDirectories(
    runtimePackages,
    composition.registrarUrl ?? import.meta.url,
  );
  if (moduleDirectories.length > 0) {
    api.modifyResolvedConfig(config => ({
      ...config,
      builderPlugins: [
        ...(config.builderPlugins ?? []),
        createRuntimePackageResolutionPlugin(moduleDirectories),
      ],
    }));
  }

  if (options.serverExtensions !== false) {
    const serverPluginName =
      composition.serverPluginName ?? SERVER_EXTENSIONS_PLUGIN_NAME;
    api._internalServerPlugins(({ plugins }: ServerPluginsInput) => {
      if (
        !plugins.some(
          plugin =>
            plugin.name === serverPluginName ||
            plugin.name === SERVER_EXTENSIONS_PLUGIN_NAME ||
            plugin.name === ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
        )
      ) {
        plugins.push({ name: serverPluginName });
      }
      return { plugins };
    });
  }
};

/**
 * The fork defaults as a CLI plugin.
 *
 * The descriptor this registers may land before the ones it wraps — CLI
 * ordering cannot be constrained here without a cycle, because the plugins
 * that emit those descriptors are themselves ordered after `appTools()`.
 * Ordering is settled on the runtime side instead: `rendererHeadPlugin`
 * declares the runtime plugins that run before it.
 */
export const createPolicyDefaultsPlugin = (
  options: PolicyDefaultsOptions = {},
  composition: PolicyDefaultsComposition = {},
) => ({
  name: composition.pluginName ?? POLICY_DEFAULTS_PLUGIN_NAME,
  setup(api: PolicyDefaultsPluginApi) {
    applyPolicyDefaults(api, options, composition);
  },
});
