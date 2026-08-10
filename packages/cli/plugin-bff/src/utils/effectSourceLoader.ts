// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import crypto from 'node:crypto';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  build,
  type Loader,
  type OnLoadArgs,
  type Plugin,
  transform,
} from 'esbuild';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

const SOURCE_LOADERS = new Map<string, Loader>([
  ['.js', 'js'],
  ['.jsx', 'jsx'],
  ['.mjs', 'js'],
  ['.cjs', 'js'],
  ['.ts', 'ts'],
  ['.tsx', 'tsx'],
  ['.mts', 'ts'],
  ['.cts', 'ts'],
]);

export type EffectSourceLoaderOptions = {
  resourcePath: string;
  appDir?: string;
  onDependency?: (dependency: string) => void;
};

function sourceLoader(args: OnLoadArgs): Loader | undefined {
  return SOURCE_LOADERS.get(path.extname(args.path).toLowerCase());
}

function preserveSourceModuleSemantics(): Plugin {
  return {
    name: 'modern-js-effect-source-semantics',
    setup(buildApi) {
      buildApi.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        const loader = sourceLoader(args);
        if (!loader) {
          return undefined;
        }

        const source = await fs.promises.readFile(args.path, 'utf8');
        const compiled = await transform(source, {
          define: {
            'import.meta.url': JSON.stringify(pathToFileURL(args.path).href),
          },
          jsx: 'automatic',
          loader,
          sourcefile: args.path,
          target: 'node20',
        });

        return {
          contents: compiled.code,
          loader: 'js',
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map(name => `node:${name}`),
]);
const dependencyResolutionMarker = 'modern-js-effect-dependency-resolution';

async function isEsmOnlyFile(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.mjs' || extension === '.mts') {
    return true;
  }
  if (extension === '.cjs' || extension === '.cts') {
    return false;
  }

  let directory = path.dirname(filename);
  while (true) {
    const packagePath = path.join(directory, 'package.json');
    try {
      const packageJson = JSON.parse(
        await fs.promises.readFile(packagePath, 'utf8'),
      ) as { type?: unknown };
      return packageJson.type === 'module';
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return false;
    }
    directory = parent;
  }
}

function isBareSpecifier(specifier: string) {
  return (
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !path.isAbsolute(specifier)
  );
}

/**
 * Keep installed registry dependencies external while bundling symlinked
 * workspace source packages. Node can execute registry packages from the
 * deployment node_modules tree, but it intentionally refuses to type-strip
 * raw TypeScript copied under node_modules. Bundling workspace source into the
 * Effect entry before deployment makes that entry relocatable and executable.
 */
function externalizeInstalledDependencies(options: {
  format: 'cjs' | 'esm';
  runtimeResolveDir: string;
}): Plugin {
  const runtimeRequire = createRequire(
    path.join(options.runtimeResolveDir, '__modern_effect_entry.cjs'),
  );
  return {
    name: 'modern-js-effect-installed-dependencies',
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, async args => {
        if (
          !isBareSpecifier(args.path) ||
          nodeBuiltins.has(args.path) ||
          args.pluginData?.[dependencyResolutionMarker] === true
        ) {
          return nodeBuiltins.has(args.path)
            ? { external: true, path: args.path }
            : undefined;
        }

        const resolution = await buildApi.resolve(args.path, {
          importer: args.importer,
          kind: args.kind,
          namespace: args.namespace,
          pluginData: {
            ...args.pluginData,
            [dependencyResolutionMarker]: true,
          },
          resolveDir: args.resolveDir,
        });
        if (resolution.errors.length > 0) {
          return { external: true, path: args.path };
        }
        if (resolution.external || !resolution.path) {
          return { external: true, path: args.path };
        }

        const realPath = await fs.promises
          .realpath(resolution.path)
          .catch(() => resolution.path);
        if (realPath.includes(`${path.sep}node_modules${path.sep}`)) {
          const runtimeResolution = await buildApi.resolve(args.path, {
            importer: '',
            kind: args.kind,
            namespace: 'file',
            pluginData: {
              [dependencyResolutionMarker]: true,
            },
            resolveDir: options.runtimeResolveDir,
          });
          if (runtimeResolution.errors.length === 0 && runtimeResolution.path) {
            if (options.format === 'cjs') {
              let requiredPath: string;
              try {
                requiredPath = runtimeRequire.resolve(args.path);
              } catch {
                requiredPath = runtimeResolution.path;
              }
              if (await isEsmOnlyFile(requiredPath)) {
                return {
                  namespace: resolution.namespace,
                  path: resolution.path,
                  pluginData: resolution.pluginData,
                  sideEffects: resolution.sideEffects,
                  suffix: resolution.suffix,
                  warnings: resolution.warnings,
                  watchDirs: resolution.watchDirs,
                  watchFiles: resolution.watchFiles,
                };
              }
            }
            return { external: true, path: args.path };
          }
        }

        return {
          namespace: resolution.namespace,
          path: resolution.path,
          pluginData: resolution.pluginData,
          sideEffects: resolution.sideEffects,
          suffix: resolution.suffix,
          warnings: resolution.warnings,
          watchDirs: resolution.watchDirs,
          watchFiles: resolution.watchFiles,
        };
      });
    },
  };
}

export async function bundleEffectEntryForNode(options: {
  appDir: string;
  entryPath: string;
  format: 'cjs' | 'esm';
}) {
  await build({
    absWorkingDir: options.appDir,
    allowOverwrite: true,
    bundle: true,
    entryPoints: [options.entryPath],
    format: options.format,
    logLevel: 'silent',
    outfile: options.entryPath,
    platform: 'node',
    plugins: [
      externalizeInstalledDependencies({
        format: options.format,
        runtimeResolveDir: options.appDir,
      }),
      preserveSourceModuleSemantics(),
    ],
    target: 'node20',
  });
}

function isWatchableInput(filename: string) {
  return (
    !filename.includes(`${path.sep}node_modules${path.sep}`) &&
    (SOURCE_LOADERS.has(path.extname(filename).toLowerCase()) ||
      path.extname(filename).toLowerCase() === '.json')
  );
}

function normalizeImportedModule(module: unknown): unknown {
  if (!module || typeof module !== 'object') {
    return module;
  }
  const namespace = module as Record<string, unknown>;
  const commonJsModule = namespace.default;
  if (
    Object.keys(namespace).length === 1 &&
    commonJsModule !== null &&
    typeof commonJsModule === 'object' &&
    (commonJsModule as Record<string, unknown>).__esModule === true
  ) {
    return commonJsModule;
  }
  return module;
}

/**
 * Loads an Effect source entry as native ESM while keeping its complete local
 * source graph observable by the framework watcher.
 */
export async function loadEffectSourceModule(
  options: EffectSourceLoaderOptions,
): Promise<unknown> {
  const resourcePath = path.resolve(options.resourcePath);
  const appDir = path.resolve(options.appDir ?? path.dirname(resourcePath));
  const tsconfigPath = path.join(appDir, 'tsconfig.json');
  const cacheDirectory = path.join(
    appDir,
    'node_modules',
    '.cache',
    'modern-js',
    'effect-source-loader',
  );
  const outputName = crypto
    .createHash('sha256')
    .update(resourcePath)
    .digest('hex')
    .slice(0, 24);
  const outputPath = path.join(cacheDirectory, `${outputName}.mjs`);
  await fs.promises.mkdir(cacheDirectory, { recursive: true });

  const result = await build({
    absWorkingDir: appDir,
    banner: {
      js: `import { createRequire as __modernCreateEffectRequire } from 'node:module'; const require = __modernCreateEffectRequire(${JSON.stringify(pathToFileURL(resourcePath).href)});`,
    },
    bundle: true,
    entryPoints: [resourcePath],
    format: 'esm',
    jsx: 'automatic',
    logLevel: 'silent',
    metafile: true,
    outfile: outputPath,
    platform: 'node',
    plugins: [
      externalizeInstalledDependencies({
        format: 'esm',
        runtimeResolveDir: appDir,
      }),
      preserveSourceModuleSemantics(),
    ],
    sourcemap: 'inline',
    target: 'node20',
    tsconfig: fs.existsSync(tsconfigPath) ? tsconfigPath : undefined,
  });

  for (const input of Object.keys(result.metafile.inputs)) {
    const dependency = path.isAbsolute(input)
      ? path.normalize(input)
      : path.resolve(appDir, input);
    if (isWatchableInput(dependency)) {
      options.onDependency?.(dependency);
    }
  }

  const output = await fs.promises.readFile(outputPath);
  const revision = crypto.createHash('sha256').update(output).digest('hex');
  return normalizeImportedModule(
    await dynamicImport(`${pathToFileURL(outputPath).href}?v=${revision}`),
  );
}
