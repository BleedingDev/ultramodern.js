// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import crypto from 'node:crypto';
import fs from 'node:fs';
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
    packages: 'external',
    platform: 'node',
    plugins: [preserveSourceModuleSemantics()],
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
