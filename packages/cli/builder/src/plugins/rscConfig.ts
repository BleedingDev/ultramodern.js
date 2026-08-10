import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import path from 'path';

// Constants for RSC configuration
const ASYNC_STORAGE_PATTERN = /universal[/\\]async_storage/;
const SERVER_LOADER_ENTRY_PATTERN =
  /[/\\](?:server-loader-combined|route-server-loaders)\.js$/;
const RENDER_RSC_SOURCE_PATTERN = /render[/\\].*[/\\]server[/\\]rsc/;
const RENDER_RSC_RSLIB_ENTRY_PATTERN =
  /render[/\\]dist[/\\]esm[/\\]rsc(?:Worker)?\.mjs$/;
const RENDER_RSC_RUNTIME = '@modern-js/render/rsc';
const RENDER_RSC_WORKER_RUNTIME = '@modern-js/render/rsc-worker';
const RSC_COMMON_LAYER = 'rsc-common';
const ENTRY_NAME_VAR = '__MODERN_JS_ENTRY_NAME';
const SERVER_ONLY_MARKER_PATTERN =
  /(?:^|[/\\])server-only[/\\]index\.js(?:\?|$)/;
const SERVER_ONLY_MESSAGE_PATTERN =
  /server-only|server only|only works in a Server Component|cannot be imported (?:directly )?(?:from|into) (?:a )?Client Component/i;
const SERVER_ONLY_DIAGNOSTIC_PREFIX =
  '[Modern.js RSC server-only diagnostic context]';
const ROUTE_DATA_FILE_PATTERN =
  /[/\\]routes[/\\](?:.*[/\\])?(?:layout|page|\$)\.(?:loader|data)\.[tj]sx?(?:\?.*)?$/;

type RspackDiagnostic = Error & {
  details?: string;
  file?: string;
  module?: DiagnosticModule | null;
  moduleTrace?: Array<{
    module?: DiagnosticModule | null;
    moduleName?: string;
    origin?: DiagnosticModule | null;
    originName?: string;
  }>;
};

type DiagnosticModule = {
  resource?: string;
  request?: string;
  userRequest?: string;
  rawRequest?: string;
  layer?: string;
  context?: string;
  identifier?: () => string;
  readableIdentifier?: (requestShortener?: unknown) => string;
  nameForCondition?: () => string | undefined;
};

type DiagnosticCompilation = {
  errors: RspackDiagnostic[];
  name?: string;
  moduleGraph?: {
    getIssuer?: (module: DiagnosticModule) => DiagnosticModule | null;
  };
  warnings: RspackDiagnostic[];
};

const createVirtualModule = (content: string) =>
  `data:text/javascript,${encodeURIComponent(content)}`;

const isAsyncStorageExclude = (exclude: unknown) => {
  if (typeof exclude === 'string') {
    return ASYNC_STORAGE_PATTERN.test(exclude);
  }
  if (exclude instanceof RegExp) {
    // Check semantic equivalence instead of relying on `source` string matching
    return (
      exclude.test('universal/async_storage') ||
      exclude.test('universal\\async_storage')
    );
  }
  return false;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
};

const disableReactCompilerInSwcLoaders = (
  value: unknown,
  seen = new WeakSet<object>(),
) => {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      disableReactCompilerInSwcLoaders(item, seen);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  if (record.loader === 'builtin:swc-loader') {
    let options = asRecord(record.options);
    if (!options) {
      options = {};
      record.options = options;
    }

    let jsc = asRecord(options.jsc);
    if (!jsc) {
      jsc = {};
      options.jsc = jsc;
    }

    let transform = asRecord(jsc.transform);
    if (!transform) {
      transform = {};
      jsc.transform = transform;
    }

    transform.reactCompiler = false;
  }

  for (const item of Object.values(record)) {
    disableReactCompilerInSwcLoaders(item, seen);
  }
};

const normalizeDiagnosticText = (diagnostic: RspackDiagnostic) =>
  [
    diagnostic.message,
    diagnostic.details,
    diagnostic.file,
    getModulePath(diagnostic.module),
    getModuleIdentifier(diagnostic.module),
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');

const isServerOnlyDiagnostic = (diagnostic: RspackDiagnostic) => {
  const text = normalizeDiagnosticText(diagnostic);
  return (
    SERVER_ONLY_MARKER_PATTERN.test(text) ||
    SERVER_ONLY_MESSAGE_PATTERN.test(text)
  );
};

const isEnrichedServerOnlyDiagnostic = (diagnostic: RspackDiagnostic) =>
  diagnostic.message.includes(SERVER_ONLY_DIAGNOSTIC_PREFIX) ||
  diagnostic.details?.includes(SERVER_ONLY_DIAGNOSTIC_PREFIX);

const getModulePath = (module?: DiagnosticModule | null) => {
  if (!module) {
    return undefined;
  }
  return module.resource || module.nameForCondition?.() || module.userRequest;
};

const getModuleIdentifier = (module?: DiagnosticModule | null) => {
  if (!module) {
    return undefined;
  }
  return (
    getModulePath(module) ||
    module.readableIdentifier?.() ||
    module.identifier?.() ||
    module.request ||
    module.rawRequest
  );
};

const formatModuleContext = (module?: DiagnosticModule | null) => {
  const id = getModuleIdentifier(module);
  if (!id) {
    return undefined;
  }
  const layer = module?.layer ? ` [layer: ${module.layer}]` : '';
  return `${id}${layer}`;
};

const getIssuerChain = (
  compilation: DiagnosticCompilation,
  module?: DiagnosticModule | null,
) => {
  const chain: string[] = [];
  const seen = new Set<DiagnosticModule>();
  let current = module;

  while (current && !seen.has(current) && chain.length < 8) {
    seen.add(current);
    const issuer = compilation.moduleGraph?.getIssuer?.(current);
    const formatted = formatModuleContext(issuer);
    if (!issuer || !formatted) {
      break;
    }
    chain.push(formatted);
    current = issuer;
  }

  return chain;
};

const getModuleTraceChain = (diagnostic: RspackDiagnostic) => {
  const trace = diagnostic.moduleTrace || [];
  const chain: string[] = [];

  for (const item of trace) {
    const formatted =
      formatModuleContext(item.origin) ||
      item.originName ||
      formatModuleContext(item.module) ||
      item.moduleName;
    if (formatted && !chain.includes(formatted)) {
      chain.push(formatted);
    }
  }

  return chain.slice(0, 8);
};

const appendDiagnosticDetails = (
  diagnostic: RspackDiagnostic,
  lines: string[],
) => {
  const context = `${SERVER_ONLY_DIAGNOSTIC_PREFIX}\n${lines.join('\n')}`;
  diagnostic.details = diagnostic.details
    ? `${diagnostic.details}\n\n${context}`
    : context;
};

export const enrichServerOnlyDiagnostics = (
  compilation: DiagnosticCompilation,
  environmentName?: string,
) => {
  const diagnostics = [...compilation.warnings, ...compilation.errors];

  for (const diagnostic of diagnostics as RspackDiagnostic[]) {
    if (
      !isServerOnlyDiagnostic(diagnostic) ||
      isEnrichedServerOnlyDiagnostic(diagnostic)
    ) {
      continue;
    }

    const lines = [
      `Environment: ${environmentName || compilation.name || 'unknown'}`,
    ];
    const markerModule = formatModuleContext(diagnostic.module);
    if (markerModule) {
      lines.push(`Matched module: ${markerModule}`);
    }

    const issuerChain = getIssuerChain(compilation, diagnostic.module);
    const moduleTraceChain = getModuleTraceChain(diagnostic);
    const importerChain =
      issuerChain.length > 0 ? issuerChain : moduleTraceChain;
    if (importerChain.length > 0) {
      lines.push(`Importer chain: ${importerChain.join(' -> ')}`);
    }

    appendDiagnosticDetails(diagnostic, lines);
  }
};

const applyServerOnlyDiagnosticPlugin = (
  compiler: Rspack.Compiler,
  environmentName?: string,
) => {
  compiler.hooks.thisCompilation.tap(
    'ModernJsServerOnlyDiagnosticContextPlugin',
    compilation => {
      compilation.hooks.processWarnings.tap(
        'ModernJsServerOnlyDiagnosticContextPlugin',
        warnings => {
          enrichServerOnlyDiagnostics(
            {
              errors: compilation.errors,
              moduleGraph: compilation.moduleGraph,
              warnings,
            },
            environmentName || compilation.name || compiler.name,
          );
          return warnings;
        },
      );

      compilation.hooks.afterSeal.tapPromise(
        'ModernJsServerOnlyDiagnosticContextPlugin',
        async () => {
          enrichServerOnlyDiagnostics(
            compilation,
            environmentName || compilation.name || compiler.name,
          );
        },
      );
    },
  );
};

const applyServerOnlyDiagnosticPlugins = (
  compiler: Rspack.Compiler | Rspack.MultiCompiler,
  environments: Record<string, { name: string; index: number }>,
) => {
  const compilers = 'compilers' in compiler ? compiler.compilers : [compiler];

  compilers.forEach((childCompiler, index) => {
    const environmentName =
      childCompiler.name ||
      Object.values(environments).find(
        environment => environment.index === index,
      )?.name;
    applyServerOnlyDiagnosticPlugin(childCompiler, environmentName);
  });
};

/**
 * Unified plugin for RSC (React Server Components) configuration
 * Handles:
 * 1. Adding layer configuration to server-side entries
 * 2. Excluding /universal[/\\]async_storage/ from react-server-components layer
 * 3. Adding rsc-common layer for /universal[/\\]async_storage/
 * 4. Adding entry name virtual module for client-side entries
 * 5. Adding 'use server-entry' directive to route components
 */
export function pluginRscConfig(): RsbuildPlugin {
  return {
    name: 'builder:rsc-config',
    setup(api) {
      // Cache for dynamically imported Layers to avoid multiple imports
      let layersCache: { ssr: string; rsc: string } | null = null;
      const getLayers = async () => {
        if (!layersCache) {
          // Dynamically import Layers to avoid CJS -> ESM require() issue
          // rsbuild-plugin-rsc is a pure ESM module (type: "module")
          // Static import in CJS code causes issues in e2e test environments
          const { Layers } = await import('rsbuild-plugin-rsc');
          layersCache = Layers;
        }
        return layersCache;
      };

      // Add 'use server-entry' directive to route components
      // Match:
      // 1. layout.[tj]sx, page.[tj]sx, and $.[tj]sx files in routes directory (conventional routing)
      // 2. App.[tj]sx files anywhere (self-controlled routing)
      api.modifyBundlerChain({
        handler: (chain, { isServer }) => {
          if (isServer) {
            chain.resolve.alias.set(
              `${RENDER_RSC_RUNTIME}$`,
              RENDER_RSC_WORKER_RUNTIME,
            );
            let emptyModulePath: string;
            try {
              emptyModulePath = require.resolve('../shared/rsc/rscEmptyModule');
            } catch {
              emptyModulePath = path.resolve(
                __dirname,
                '../shared/rsc/rscEmptyModule',
              );
            }
            chain.module
              .rule('rsc-route-data-server-only')
              .test(ROUTE_DATA_FILE_PATTERN)
              .resolve.alias.set('server-only$', emptyModulePath);
            // Pattern 1: Match route files in routes directory (conventional routing)
            // Matches: layout.tsx, layout.ts, layout.jsx, layout.js
            //         page.tsx, page.ts, page.jsx, page.js
            //         $.tsx, $.ts, $.jsx, $.js
            // Use [/\\] before filename so both Unix (/) and Windows (\) paths match
            const routeFilePattern =
              /[/\\]routes[/\\](?:.*[/\\])?(?:layout|page|\$)\.[tj]sx?$/;

            // Pattern 2: Match App.[tj]sx files anywhere (self-controlled routing)
            // Matches: App.tsx, App.ts, App.jsx, App.js in any directory
            // Note: node_modules is already excluded by the exclude rule
            const appFilePattern = /[/\\]App\.[tj]sx?$/;

            // Combine both patterns
            const combinedPattern = new RegExp(
              `(${routeFilePattern.source}|${appFilePattern.source})`,
            );

            // Use path.resolve to handle both TypeScript source and compiled JavaScript
            // Try require.resolve first, fallback to path.resolve if it fails
            let loaderPath: string;
            try {
              loaderPath = require.resolve(
                '../shared/rsc/rsc-server-entry-loader',
              );
            } catch {
              // Fallback for test environments where require.resolve may not work with TS files
              loaderPath = path.resolve(
                __dirname,
                '../shared/rsc/rsc-server-entry-loader',
              );
            }

            chain.module
              .rule('rsc-server-entry')
              .test(/\.(tsx?|jsx?)$/)
              .resource(combinedPattern)
              .exclude.add(/node_modules/)
              .end()
              .use('rsc-server-entry-loader')
              .loader(loaderPath)
              .end();
          }
        },
        // Use 'pre' order to ensure it runs before other loaders process the files
        order: 'pre',
      });

      api.modifyRspackConfig(async (config, utils) => {
        // Check if this is a server build by checking target or environment name
        const isServer =
          config.target === 'node' ||
          utils.target === 'node' ||
          utils.environment?.name === 'server';

        if (!isServer) {
          return;
        }

        // Dynamically import Layers to avoid CJS -> ESM require() issue
        const Layers = await getLayers();

        // 1. Add layer configuration to server-side entries
        if (config.entry) {
          const entries = config.entry;
          const newEntries: Record<
            string,
            string | string[] | { import: string | string[]; layer: string }
          > = {};

          for (const [entryName, entryValue] of Object.entries(entries)) {
            if (typeof entryValue === 'string') {
              newEntries[entryName] = {
                import: entryValue,
                layer: Layers.ssr,
              };
            } else if (Array.isArray(entryValue)) {
              newEntries[entryName] = {
                import: entryValue,
                layer: Layers.ssr,
              };
            } else if (typeof entryValue === 'object' && entryValue !== null) {
              // If already an object, add or update layer
              newEntries[entryName] = {
                ...entryValue,
                layer: Layers.ssr,
              };
            } else {
              newEntries[entryName] = entryValue;
            }
          }

          config.entry = newEntries;
        }

        // 2. Exclude /universal[/\\]async_storage/ from react-server-components layer
        // 3. Add rsc-common layer for /universal[/\\]async_storage/
        if (config.module?.rules) {
          const rules = config.module.rules as Rspack.RuleSetRule[];

          // React 19.2 does not expose a server-compatible compiler runtime.
          // Keep React Compiler out of the RSC server layer so generated server
          // component code does not import react/compiler-runtime.
          disableReactCompilerInSwcLoaders(rules);

          // Find and modify rules that have layer: 'react-server-components'
          for (const rule of rules) {
            // Check if this rule has layer: 'react-server-components'
            if (rule.layer === Layers.rsc) {
              // Add exclude to the rule
              if (!rule.exclude) {
                rule.exclude = [];
              } else if (!Array.isArray(rule.exclude)) {
                rule.exclude = [rule.exclude];
              }

              // Check if the exclude pattern already exists
              const hasExclude = rule.exclude.some(isAsyncStorageExclude);

              if (!hasExclude) {
                rule.exclude.push(ASYNC_STORAGE_PATTERN);
              }
            }
          }

          // Ensure module.rules is an array
          if (!Array.isArray(config.module.rules)) {
            config.module.rules = [];
          }

          // Add rsc-common rule
          config.module.rules.push({
            resource: ASYNC_STORAGE_PATTERN,
            layer: RSC_COMMON_LAYER,
          });
        }
      });

      api.onAfterCreateCompiler(({ compiler, environments }) => {
        applyServerOnlyDiagnosticPlugins(compiler, environments);
      });

      // 4. Add entry name virtual module for client-side entries
      api.modifyBundlerChain((chain, { isServer, isWebWorker }) => {
        if (!isServer && !isWebWorker) {
          const entries = chain.entryPoints.entries();
          if (entries && typeof entries === 'object') {
            for (const entryName of Object.keys(entries)) {
              const entryPoint = chain.entry(entryName);
              const code = `window.${ENTRY_NAME_VAR}="${entryName}";`;
              entryPoint.add(createVirtualModule(code));
            }
          }
        }
      });
    },
  };
}

/**
 * Get RSC plugins based on configuration
 * @param enableRsc - Whether RSC is enabled
 * @param internalDirectory - Internal directory path for route matching
 * @param environments - Optional mapping of the RSC plugin's `server`/`client`
 *   environments onto existing Rsbuild environment names. When omitted, the RSC
 *   plugin uses its defaults (`'server'` / `'client'`). Frameworks that already
 *   declare their own environments can point RSC at them instead of having the
 *   plugin create new empty environments (which would otherwise fall back to the
 *   default `./src` entry and fail to resolve).
 * @returns Array of RSC-related plugins
 */
export async function getRscPlugins(
  enableRsc: boolean,
  internalDirectory: string,
  environments?: { server?: string; client?: string },
): Promise<RsbuildPlugin[]> {
  if (enableRsc) {
    const rscLayerMatchers = createRscLayerMatchers(internalDirectory);
    // Dynamically import pluginRSC to avoid CJS -> ESM require() issue(e2e test cases in CI)
    // rsbuild-plugin-rsc is a pure ESM module (type: "module")
    // Static import in CJS code causes issues in e2e test environments
    const { pluginRSC } = await import('rsbuild-plugin-rsc');
    return [
      pluginRSC({
        ...(environments ? { environments } : {}),
        layers: {
          ssr: SERVER_LOADER_ENTRY_PATTERN,
          rsc: [
            RENDER_RSC_SOURCE_PATTERN,
            RENDER_RSC_RSLIB_ENTRY_PATTERN,
            /AppProxy/,
            ...rscLayerMatchers,
          ],
        },
      }),
      pluginRscConfig(),
    ];
  }
  return [];
}

export function createRscLayerMatchers(internalDirectory: string) {
  const routesFileReg = new RegExp(
    `${internalDirectory.replace(/[/\\]/g, '[/\\\\]')}[/\\\\][^/\\\\]*[/\\\\]routes`,
  );
  return [routesFileReg, ROUTE_DATA_FILE_PATTERN];
}
