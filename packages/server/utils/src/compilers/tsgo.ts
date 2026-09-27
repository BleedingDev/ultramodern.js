import { fs } from '@modern-js/utils';
import { spawn } from 'child_process';
import path from 'path';

type TsgoConfig = {
  compilerOptions?: {
    allowJs?: boolean;
    baseUrl?: string;
    composite?: boolean;
    declaration?: boolean;
    declarationMap?: boolean;
    emitDeclarationOnly?: boolean;
    experimentalDecorators?: boolean;
    incremental?: boolean;
    jsx?: string;
    moduleResolution?: string;
    noEmit?: boolean;
    noEmitOnError?: boolean;
    outDir?: string;
    paths?: Record<string, string[]>;
    rootDir?: string;
    tsBuildInfoFile?: string;
  };
  files?: string[];
  include?: string[];
  references?: Array<{ path: string }>;
};

type NativePreviewPackageJson = {
  bin?:
    | string
    | {
        tsc?: string;
        tsgo?: string;
      };
};

// Distinguishes concurrent compiles within the same process (plugin-bff and
// app-tools both call into this compiler) so their temp configs cannot clash.
let resolvedConfigCount = 0;

/**
 * Write a one-shot tsconfig for type-checking (and, when the app asks for
 * declarations, declaration emit) of exactly the server source directories.
 * JavaScript is emitted by Rslib, so nothing here shapes runtime output.
 */
export const createResolvedTsgoConfig = async (
  appDirectory: string,
  tsconfigPath: string,
  sourceDirs: string[],
  tsgoBinPath: string,
  excludeFiles: string[] = [],
) => {
  const tsconfigDir = path.dirname(tsconfigPath);
  const output = await runTsgo(
    tsgoBinPath,
    ['--showConfig', '-p', tsconfigPath],
    { cwd: tsconfigDir },
  );
  const config = JSON.parse(output.stdout) as TsgoConfig;

  config.compilerOptions ??= {};
  const options = config.compilerOptions;
  options.rootDir = appDirectory;
  options.composite = false;
  options.declarationMap = false;
  options.incremental = false;
  // Rslib's declaration emit reads this config; the type check passes --noEmit.
  options.noEmit = options.declaration !== true;
  // Server sources may import TSX; `jsx` unset fails every such import.
  options.jsx ??= 'react-jsx';
  delete options.emitDeclarationOnly;
  delete options.outDir;
  delete options.tsBuildInfoFile;
  // `--showConfig` emits `files` relative to the tsconfig directory.
  config.files = filterSourceFiles(
    tsconfigDir,
    sourceDirs,
    config.files,
    excludeFiles,
  );
  delete config.include;
  // Project references make TS-Go require declaration outputs of sibling
  // workspace packages that this check never builds (TS6305 on a clean
  // checkout). Their sources stay reachable through module resolution.
  delete config.references;

  // TS-Go v7 removed baseUrl. Rebase `paths` onto the tsconfig directory so
  // TS-Go and Rspack's tsconfig resolver both see the mapping the app wrote.
  if (options.baseUrl !== undefined) {
    const baseUrl = path.resolve(tsconfigDir, options.baseUrl);
    if (options.paths) {
      options.paths = Object.fromEntries(
        Object.entries(options.paths).map(([key, targets]) => [
          key,
          targets.map(target => {
            const relative = path
              .relative(tsconfigDir, path.resolve(baseUrl, target))
              .split(path.sep)
              .join(path.posix.sep);
            return relative.startsWith('.') ? relative : `./${relative}`;
          }),
        ]),
      );
    }
    delete options.baseUrl;
  }
  if (
    ['node', 'node10'].includes(String(options.moduleResolution).toLowerCase())
  ) {
    delete options.moduleResolution;
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

const toPosix = (file: string) => file.split(path.sep).join(path.posix.sep);

const filterSourceFiles = (
  tsconfigDir: string,
  sourceDirs: string[],
  files: string[] = [],
  excludeFiles: string[] = [],
) => {
  const sourcePosixPaths = sourceDirs.map(toPosix);
  const excludedPaths = new Set(
    excludeFiles.map(file => toPosix(path.normalize(file))),
  );

  return files.filter(fileName => {
    const absoluteFileName = toPosix(path.resolve(tsconfigDir, fileName));
    if (excludedPaths.has(absoluteFileName)) {
      return false;
    }
    return (
      fileName.endsWith('.d.ts') ||
      sourcePosixPaths.some(sourceDir => absoluteFileName.includes(sourceDir))
    );
  });
};

export const runTsgo = (
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
  return pkg.bin?.tsc ?? pkg.bin?.tsgo;
};

const TSGO_PACKAGES = ['@typescript/native', '@typescript/native-preview'];

// Resolve the TS-Go package from the app first (so apps control the compiler
// version), then from this package's own dependency tree (covering hoisted
// installs). The `resolvePaths` parameter exists for tests.
const resolveTsgoPackage = (resolvePaths: string[]) => {
  for (const name of TSGO_PACKAGES) {
    try {
      const pkgPath = require.resolve(`${name}/package.json`, {
        paths: resolvePaths,
      });
      return { name, pkgPath };
    } catch {}
  }
  throw new Error(
    'tsgo could not be found! Please install "@typescript/native" (or legacy "@typescript/native-preview") in your project to type-check BFF/server code.',
  );
};

export const getTsgoBinPath = (
  appDirectory: string,
  resolvePaths: string[] = [appDirectory, __dirname],
) => {
  const { pkgPath } = resolveTsgoPackage(resolvePaths);
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

/**
 * The TS-Go package entry that Rslib's declaration emitter loads to read the
 * compiler version and locate its executable.
 */
export const getTsgoModulePath = (
  appDirectory: string,
  resolvePaths: string[] = [appDirectory, __dirname],
) => {
  const { name } = resolveTsgoPackage(resolvePaths);
  return require.resolve(name, { paths: resolvePaths });
};
