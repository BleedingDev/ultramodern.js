import { fs, getAliasConfig, logger } from '@modern-js/utils';
import { spawn } from 'child_process';
import path from 'path';
import type { CompileFunc } from '../../common';
import {
  createTsconfigPathsMatcher,
  getNotAliasedPath,
} from './tsconfigPathsPlugin';

type TsgoConfig = {
  compilerOptions?: {
    baseUrl?: unknown;
    moduleResolution?: string;
    noEmitOnError?: boolean;
    outDir?: string;
    rootDir?: string;
  };
  files?: string[];
  include?: string[];
};

const importSpecifierRE =
  /((?:from\s*|import\s*\(\s*|require\s*\(\s*)['"])([^'"]+)(['"])/g;

const copyFiles = async (from: string, to: string, appDirectory: string) => {
  if (await fs.pathExists(from)) {
    const relativePath = path.relative(appDirectory, from);
    const targetDir = path.join(to, relativePath);
    await fs.copy(from, targetDir, {
      filter: src =>
        !['.ts', '.js'].includes(path.extname(src)) &&
        !src.endsWith('tsconfig.json'),
    });
  }
};

const createResolvedTsgoConfig = async (
  appDirectory: string,
  tsconfigPath: string,
  distDir: string,
  sourceDirs: string[],
) => {
  const output = await runTsgo(['--showConfig', '-p', tsconfigPath], {
    cwd: path.dirname(tsconfigPath),
  });
  const config = JSON.parse(output.stdout) as TsgoConfig;

  config.compilerOptions ??= {};
  config.compilerOptions.rootDir = appDirectory;
  config.compilerOptions.outDir = distDir;
  config.files = filterSourceFiles(appDirectory, sourceDirs, config.files);
  delete config.include;

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

  // Keep the generated config beside the app tsconfig so relative `files` and
  // `paths` entries keep the same base directory.
  const resolvedConfigPath = path.join(
    appDirectory,
    `.tsgo.${process.pid}.resolved.json`,
  );
  await fs.writeFile(resolvedConfigPath, JSON.stringify(config, null, 2));

  return { config, resolvedConfigPath };
};

const filterSourceFiles = (
  appDirectory: string,
  sourceDirs: string[],
  files: string[] = [],
) => {
  const sourcePosixPaths = sourceDirs.map(sourceDir =>
    sourceDir.split(path.sep).join(path.posix.sep),
  );

  return files.filter(fileName => {
    const absoluteFileName = path
      .resolve(appDirectory, fileName)
      .split(path.sep)
      .join(path.posix.sep);

    return (
      fileName.endsWith('.d.ts') ||
      sourcePosixPaths.some(sourceDir => absoluteFileName.includes(sourceDir))
    );
  });
};

const runTsgo = (
  args: string[],
  options: {
    cwd: string;
    reject?: boolean;
  },
) =>
  new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [getTsgoBinPath(), ...args], {
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

const getTsgoBinPath = () =>
  path.join(
    path.dirname(require.resolve('@typescript/native-preview/package.json')),
    'bin/tsgo.js',
  );

const getSourceFileForOutput = (
  appDirectory: string,
  distDir: string,
  outputFile: string,
) => {
  const relativeOutput = path.relative(distDir, outputFile);
  const parsed = path.parse(relativeOutput);
  const sourceBase = path.join(appDirectory, parsed.dir, parsed.name);

  return (
    findExistingSource(`${sourceBase}.ts`) ||
    findExistingSource(`${sourceBase}.tsx`) ||
    findExistingSource(`${sourceBase}.js`) ||
    findExistingSource(`${sourceBase}.jsx`)
  );
};

const findExistingSource = (filePath: string) =>
  fs.existsSync(filePath) ? filePath : undefined;

const rewriteOutputSpecifiers = async (
  appDirectory: string,
  distDir: string,
  baseUrl: string,
  paths: Record<string, string[] | string>,
  moduleType?: 'module' | 'commonjs',
) => {
  if (Object.keys(paths).length === 0 || !(await fs.pathExists(distDir))) {
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
      let changed = false;
      const rewritten = content.replace(
        importSpecifierRE,
        (match, prefix: string, specifier: string, suffix: string) => {
          const nextSpecifier = getNotAliasedPath(
            sourceFile,
            matcher,
            specifier,
            moduleType,
          );

          if (!nextSpecifier || nextSpecifier === specifier) {
            return match;
          }

          changed = true;
          return `${prefix}${nextSpecifier}${suffix}`;
        },
      );

      if (changed) {
        await fs.writeFile(file, rewritten);
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

  const { config: tsgoConfig, resolvedConfigPath } =
    await createResolvedTsgoConfig(
      appDirectory,
      tsconfigPath,
      distDir,
      sourceDirs,
    );
  const result = await runTsgo(['-p', resolvedConfigPath], {
    cwd: appDirectory,
    reject: false,
  });
  await fs.remove(resolvedConfigPath);

  if (result.stderr) {
    logger.error(result.stderr);
  }
  if (result.stdout) {
    logger.info(result.stdout);
  }

  if (result.code !== 0) {
    const noEmitOnError = tsgoConfig.compilerOptions?.noEmitOnError;
    if (typeof noEmitOnError === 'undefined' || noEmitOnError === true) {
      if (compileOptions.throwErrorInsteadOfExit) {
        logger.error('TS-Go compilation failed');
      } else {
        process.exit(1);
      }
    }
  }

  await rewriteOutputSpecifiers(
    appDirectory,
    distDir,
    absoluteBaseUrl,
    paths,
    compileOptions.moduleType,
  );

  for (const source of sourceDirs) {
    await copyFiles(source, distDir, appDirectory);
  }

  logger.info(`TS-Go compile succeed`);
};
