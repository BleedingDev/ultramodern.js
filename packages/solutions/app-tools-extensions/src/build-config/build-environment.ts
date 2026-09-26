import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { URL } from 'node:url';

const EFFECT_TSGO_PACKAGE = '@effect/tsgo';
const EFFECT_TSGO_BIN = 'effect-tsgo';
const EFFECT_TSGO_RESOLUTION_ERROR =
  'Unable to resolve the Effect TS-Go compiler. Install "@effect/tsgo" and a native TypeScript backend for this build config, or set EFFECT_TSGO_BIN.';
const executableEffectTsgoCompilers = new Map<string, string>();

type PackageJson = {
  bin?: Record<string, string> | string;
};

function resolveEffectTsgoCli(from: string | URL): string {
  const projectRequire = createRequire(from);
  const packageJsonPath = projectRequire.resolve(
    `${EFFECT_TSGO_PACKAGE}/package.json`,
  );
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, 'utf-8'),
  ) as PackageJson;
  const bin =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.[EFFECT_TSGO_BIN];

  if (!bin) {
    throw new Error(EFFECT_TSGO_RESOLUTION_ERROR);
  }

  return resolve(dirname(packageJsonPath), bin);
}

function resolveExecutableEffectTsgoCompiler(compilerPath: string): string {
  if (process.platform === 'win32') {
    return compilerPath;
  }

  const sourcePath = realpathSync(compilerPath);
  const source = lstatSync(sourcePath);
  if (!source.isFile()) {
    throw new Error(EFFECT_TSGO_RESOLUTION_ERROR);
  }

  try {
    accessSync(sourcePath, constants.X_OK);
    return compilerPath;
  } catch {
    // npm currently publishes Effect TS-Go's native Unix files without an
    // execute bit. Keep node_modules immutable and materialize a private copy.
  }

  const cachedCompiler = executableEffectTsgoCompilers.get(sourcePath);
  if (cachedCompiler) {
    try {
      accessSync(cachedCompiler, constants.X_OK);
      return cachedCompiler;
    } catch {
      executableEffectTsgoCompilers.delete(sourcePath);
    }
  }

  const compilerBytes = readFileSync(sourcePath);
  const compilerDigest = createHash('sha256')
    .update(compilerBytes)
    .digest('hex');
  const compilerDirectory = join(
    tmpdir(),
    'modern-js',
    'effect-tsgo',
    compilerDigest,
  );
  mkdirSync(compilerDirectory, { recursive: true, mode: 0o700 });
  const executableCompiler = join(compilerDirectory, basename(sourcePath));
  try {
    accessSync(executableCompiler, constants.X_OK);
  } catch {
    const temporaryCompiler = join(
      compilerDirectory,
      `.${basename(sourcePath)}.${process.pid}.tmp`,
    );
    rmSync(temporaryCompiler, { force: true });
    try {
      writeFileSync(temporaryCompiler, compilerBytes, {
        flag: 'wx',
        mode: 0o700,
      });
      chmodSync(temporaryCompiler, 0o700);
      renameSync(temporaryCompiler, executableCompiler);
    } finally {
      rmSync(temporaryCompiler, { force: true });
    }
  }
  accessSync(executableCompiler, constants.X_OK);
  executableEffectTsgoCompilers.set(sourcePath, executableCompiler);
  return executableCompiler;
}

/**
 * Reads an environment variable while keeping generated build configs free of
 * direct process access.
 */
export function getBuildConfigEnvironment(name: string): string | undefined {
  return process.env[name];
}

export type ResolveEffectTsgoCompilerOptions = {
  /** Module URL or absolute filename used to resolve the consumer's compiler. */
  from: string | URL;
};

/**
 * Resolves the Effect TS-Go executable used by Module Federation DTS builds.
 */
export function resolveEffectTsgoCompiler(
  options: ResolveEffectTsgoCompilerOptions,
): string {
  const configuredCompiler =
    getBuildConfigEnvironment('EFFECT_TSGO_BIN')?.trim();

  if (configuredCompiler) {
    try {
      return resolveExecutableEffectTsgoCompiler(configuredCompiler);
    } catch {
      throw new Error(EFFECT_TSGO_RESOLUTION_ERROR);
    }
  }

  try {
    const compiler = execFileSync(
      process.execPath,
      [resolveEffectTsgoCli(options.from), 'get-exe-path'],
      { encoding: 'utf-8' },
    ).trim();

    if (compiler) {
      return resolveExecutableEffectTsgoCompiler(compiler);
    }
  } catch {
    // Use one stable error for package, platform-binary, and CLI failures.
  }

  throw new Error(EFFECT_TSGO_RESOLUTION_ERROR);
}
