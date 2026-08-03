import { fs, getAliasConfig, logger } from '@modern-js/utils';
import { spawn } from 'child_process';
import path from 'path';
import type { CompileFunc } from '../../common';
import { rewriteImportSpecifiers } from './importRewriter';
import {
  createTsconfigPathsMatcher,
  getNotAliasedPath,
} from './tsconfigPathsPlugin';

type TsgoConfig = {
  compilerOptions?: {
    allowImportingTsExtensions?: boolean;
    baseUrl?: unknown;
    composite?: boolean;
    declaration?: boolean;
    declarationMap?: boolean;
    emitDeclarationOnly?: boolean;
    incremental?: boolean;
    jsx?: string;
    module?: string;
    moduleResolution?: string;
    noEmit?: boolean;
    noEmitOnError?: boolean;
    outDir?: string;
    rootDir?: string;
    rewriteRelativeImportExtensions?: boolean;
    tsBuildInfoFile?: string;
    verbatimModuleSyntax?: boolean;
  };
  files?: string[];
  include?: string[];
  references?: Array<{ path: string }>;
};

type NativePreviewPackageJson = {
  bin?:
    | string
    | {
        tsgo?: string;
      };
};

const copyFiles = async (from: string, to: string, appDirectory: string) => {
  if (await fs.pathExists(from)) {
    const relativePath = path.relative(appDirectory, from);
    const targetDir = path.join(to, relativePath);
    await fs.copy(from, targetDir, {
      filter: src =>
        !['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(src)) &&
        !src.endsWith('tsconfig.json'),
    });
  }
};

// Distinguishes concurrent compiles within the same process (plugin-bff and
// app-tools both call into this compiler) so their temp configs cannot clash.
let resolvedConfigCount = 0;

export const createResolvedTsgoConfig = async (
  appDirectory: string,
  tsconfigPath: string,
  distDir: string,
  sourceDirs: string[],
  moduleType: 'module' | 'commonjs' | undefined,
  tsgoBinPath: string,
) => {
  const tsconfigDir = path.dirname(tsconfigPath);
  const output = await runTsgo(
    tsgoBinPath,
    ['--showConfig', '-p', tsconfigPath],
    {
      cwd: tsconfigDir,
    },
  );
  const config = JSON.parse(output.stdout) as TsgoConfig;

  config.compilerOptions ??= {};
  config.compilerOptions.rootDir = appDirectory;
  config.compilerOptions.outDir = distDir;
  config.compilerOptions.composite = false;
  config.compilerOptions.declaration = false;
  config.compilerOptions.declarationMap = false;
  config.compilerOptions.emitDeclarationOnly = false;
  config.compilerOptions.incremental = false;
  config.compilerOptions.noEmit = false;
  if (
    config.compilerOptions.jsx === undefined ||
    config.compilerOptions.jsx === 'preserve'
  ) {
    config.compilerOptions.jsx = 'react-jsx';
  }
  delete config.compilerOptions.tsBuildInfoFile;
  if (config.compilerOptions.allowImportingTsExtensions === true) {
    config.compilerOptions.rewriteRelativeImportExtensions = true;
  }
  // `--showConfig` emits `files` relative to the tsconfig directory.
  config.files = filterSourceFiles(tsconfigDir, sourceDirs, config.files);
  delete config.include;
  // This config is a one-shot server emit, not a composite project build.
  // Keeping the app's project references makes TS-Go require declaration
  // outputs from sibling workspace packages even though their source is not
  // part of this emit (TS6305 on a clean checkout). Bare workspace imports
  // remain resolved through the app's paths config and the output rewriter.
  delete config.references;

  // TS-Go v7 removed baseUrl and the node10/moduleResolution=node spelling.
  // The Modern.js server compiler still resolves aliases itself after emit, so
  // those options are not needed by the TS-Go process.
  delete config.compilerOptions.baseUrl;
  if (
    ['node', 'node10'].includes(
      String(config.compilerOptions.moduleResolution).toLowerCase(),
    )
  ) {
    delete config.compilerOptions.moduleResolution;
  }

  // The server compiler's output is executed by Node directly (never bundled),
  // so bundler-oriented emission must not leak through from app tsconfigs.
  // TS-Go v7 resolves unpinned configs to module=preserve/moduleResolution=
  // bundler, which keeps bare `import` statements in the emitted .js while the
  // dist runs as CommonJS — Node then fails on extensionless ESM imports.
  // Force CommonJS emission unless the caller explicitly compiles for ESM
  // output (moduleType 'module', which post-processes specifiers itself).
  if (moduleType !== 'module') {
    if (
      ['preserve', 'esnext', 'es2015', 'es2020', 'es2022', 'es6'].includes(
        String(config.compilerOptions.module).toLowerCase(),
      )
    ) {
      config.compilerOptions.module = 'commonjs';
      delete config.compilerOptions.moduleResolution;
    }
    config.compilerOptions.verbatimModuleSyntax = false;
  }

  // Keep the generated config beside the app tsconfig so the relative `files`
  // and `paths` entries emitted by `--showConfig` keep the same base directory.
  const resolvedConfigPath = path.join(
    tsconfigDir,
    `.tsgo.${process.pid}.${resolvedConfigCount++}.resolved.json`,
  );
  await fs.writeFile(resolvedConfigPath, JSON.stringify(config, null, 2));

  return { config, resolvedConfigPath };
};

const filterSourceFiles = (
  tsconfigDir: string,
  sourceDirs: string[],
  files: string[] = [],
) => {
  const sourcePosixPaths = sourceDirs.map(sourceDir =>
    sourceDir.split(path.sep).join(path.posix.sep),
  );

  return files.filter(fileName => {
    const absoluteFileName = path
      .resolve(tsconfigDir, fileName)
      .split(path.sep)
      .join(path.posix.sep);

    if (isAppRouterGeneratedDeclaration(absoluteFileName)) {
      return false;
    }
    return (
      fileName.endsWith('.d.ts') ||
      sourcePosixPaths.some(sourceDir => absoluteFileName.includes(sourceDir))
    );
  });
};

const isAppRouterGeneratedDeclaration = (absoluteFileName: string) =>
  /\/src\/modern-tanstack\/.*\.gen\.d\.ts$/u.test(absoluteFileName);

const runTsgo = (
  tsgoBinPath: string,
  args: string[],
  options: {
    cwd: string;
    reject?: boolean;
  },
) =>
  new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [tsgoBinPath, ...args], {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => {
        stdout += data;
      });
      child.stderr.on('data', data => {
        stderr += data;
      });
      child.on('error', reject);
      child.on('close', code => {
        const result = { stdout, stderr, code: code ?? 1 };
        if (options.reject !== false && result.code !== 0) {
          reject(
            new Error(stderr || stdout || `tsgo exited with ${result.code}`),
          );
          return;
        }
        resolve(result);
      });
    },
  );

const getTsgoBinEntry = (pkg: NativePreviewPackageJson) => {
  if (typeof pkg.bin === 'string') {
    return pkg.bin;
  }
  return pkg.bin?.tsgo;
};

const resolveTsgoBinPath = (pkgPath: string) => {
  const pkgDir = path.dirname(pkgPath);
  const pkg = require(pkgPath) as NativePreviewPackageJson;
  const declaredBinEntry = getTsgoBinEntry(pkg);
  const candidates = [
    declaredBinEntry ? path.resolve(pkgDir, declaredBinEntry) : undefined,
    path.join(pkgDir, 'bin/tsgo.js'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return (
    candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0]
  );
};

// Resolve the tsgo binary from the app first (so apps control the compiler
// version), then from this package's own dependency tree (covering hoisted
// installs, where @modern-js/builder pulls the package in). The `resolvePaths`
// parameter exists for tests.
export const getTsgoBinPath = (
  appDirectory: string,
  resolvePaths: string[] = [appDirectory, __dirname],
) => {
  try {
    const pkgPath = require.resolve('@typescript/native-preview/package.json', {
      paths: resolvePaths,
    });
    return resolveTsgoBinPath(pkgPath);
  } catch {
    throw new Error(
      'tsgo could not be found! Please install "@typescript/native-preview" in your project to compile BFF/server code.',
    );
  }
};

// Map emitted output extensions back to the source extensions that can have
// produced them (tsgo emits .mts -> .mjs, .cts -> .cjs, .ts/.tsx -> .js).
const OUTPUT_SOURCE_EXTENSIONS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
};

const getSourceFileForOutput = (
  appDirectory: string,
  distDir: string,
  outputFile: string,
) => {
  const relativeOutput = path.relative(distDir, outputFile);
  const parsed = path.parse(relativeOutput);
  const sourceBase = path.join(appDirectory, parsed.dir, parsed.name);
  const extensions =
    OUTPUT_SOURCE_EXTENSIONS[parsed.ext] ?? OUTPUT_SOURCE_EXTENSIONS['.js'];

  for (const extension of extensions) {
    const candidate = `${sourceBase}${extension}`;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const sourceMappingUrlRE = /^\/\/[#@] sourceMappingURL=.*$/gm;

// Rewriting specifiers changes column offsets without regenerating the map,
// so a stale map must not ship with the rewritten output: drop the pragma and
// the sibling .map file. Outputs that are not rewritten keep their maps.
const dropStaleSourceMap = async (outputFile: string, content: string) => {
  const mapFile = `${outputFile}.map`;
  if (await fs.pathExists(mapFile)) {
    await fs.remove(mapFile);
  }
  return content.replace(sourceMappingUrlRE, '');
};

export const rewriteOutputSpecifiers = async (
  appDirectory: string,
  distDir: string,
  baseUrl: string,
  paths: Record<string, string[] | string>,
  moduleType?: 'module' | 'commonjs',
) => {
  if (!(await fs.pathExists(distDir))) {
    return;
  }

  const matcher = createTsconfigPathsMatcher(baseUrl, paths);
  if (!matcher) {
    return;
  }

  const files = await collectOutputFiles(distDir);
  await Promise.all(
    files.map(async file => {
      const sourceFile = getSourceFileForOutput(appDirectory, distDir, file);
      if (!sourceFile) {
        return;
      }

      const content = await fs.readFile(file, 'utf8');
      const { content: rewritten, changed } = rewriteImportSpecifiers(
        content,
        specifier =>
          getNotAliasedPath(sourceFile, matcher, specifier, moduleType),
      );

      if (changed) {
        await fs.writeFile(file, await dropStaleSourceMap(file, rewritten));
      }
    }),
  );
};

const collectOutputFiles = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async entry => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectOutputFiles(fullPath);
      }
      return /\.(?:c|m)?js$/.test(entry.name) ? [fullPath] : [];
    }),
  );
  return files.flat();
};

export const compileByTs: CompileFunc = async (
  appDirectory,
  config,
  compileOptions,
) => {
  logger.info(`Running tsgo compile...`);
  const { sourceDirs, distDir, tsconfigPath } = compileOptions;
  if (!tsconfigPath) {
    return;
  }

  const { alias } = config;
  const aliasOption = getAliasConfig(alias, {
    appDirectory,
    tsconfigPath,
  });
  const { paths = {}, absoluteBaseUrl = './' } = aliasOption;

  const tsgoBinPath = getTsgoBinPath(appDirectory);

  const { config: tsgoConfig, resolvedConfigPath } =
    await createResolvedTsgoConfig(
      appDirectory,
      tsconfigPath,
      distDir,
      sourceDirs,
      compileOptions.moduleType,
      tsgoBinPath,
    );

  let result;
  try {
    result = await runTsgo(tsgoBinPath, ['-p', resolvedConfigPath], {
      cwd: appDirectory,
      reject: false,
    });
  } finally {
    await fs.remove(resolvedConfigPath);
  }

  if (result.stderr) {
    logger.error(result.stderr);
  }
  if (result.stdout) {
    logger.info(result.stdout);
  }

  // TS-Go can emit files before returning diagnostics. Normalize any emitted
  // server output before preserving the existing noEmitOnError failure path.
  await rewriteOutputSpecifiers(
    appDirectory,
    distDir,
    absoluteBaseUrl,
    paths,
    compileOptions.moduleType,
  );

  if (result.code !== 0) {
    const noEmitOnError = tsgoConfig.compilerOptions?.noEmitOnError;
    if (typeof noEmitOnError === 'undefined' || noEmitOnError === true) {
      if (compileOptions.throwErrorInsteadOfExit) {
        logger.error('TS-Go compilation failed');
        throw new Error(
          [
            `TS-Go compilation failed with exit code ${result.code}.`,
            result.stderr.trim() || result.stdout.trim(),
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } else {
        process.exit(1);
      }
    }
  }

  for (const source of sourceDirs) {
    await copyFiles(source, distDir, appDirectory);
  }

  logger.info(`TS-Go compile succeed`);
};
