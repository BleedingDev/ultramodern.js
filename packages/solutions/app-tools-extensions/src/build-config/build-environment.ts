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
import { basename, dirname, join } from 'node:path';
import type { URL } from 'node:url';

const EFFECT_TSGO_PACKAGE = '@effect/tsgo';
/** Native TypeScript packages, in the order Effect TS-Go discovers them. */
const NATIVE_TYPESCRIPT_PACKAGES = ['typescript', '@typescript/native'];
const EFFECT_TSGO_RESOLUTION_ERROR =
  'Unable to resolve the Effect TS-Go compiler. Install "@effect/tsgo" and a native TypeScript backend for this build config, or set EFFECT_TSGO_BIN.';
const executableEffectTsgoCompilers = new Map<string, string>();

type PackageJson = {
  version?: unknown;
};

type EffectTsgoUpstreamManifest = {
  components?: {
    typescript?: Record<string, unknown>;
  };
};

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(fileName, 'utf-8')) as T;
}

function resolvePackageVersion(
  packageRequire: NodeJS.Require,
  packageName: string,
): { packageJsonPath: string; version: string } | undefined {
  let packageJsonPath: string;
  try {
    packageJsonPath = packageRequire.resolve(`${packageName}/package.json`);
  } catch {
    return undefined;
  }
  const { version } = readJson<PackageJson>(packageJsonPath);
  return typeof version === 'string' ? { packageJsonPath, version } : undefined;
}

/**
 * Resolves only the TypeScript component packaged by Effect TS-Go.
 *
 * `effect-tsgo get-exe-path` discovers every integration before selecting the
 * TypeScript one, so an installed Oxlint makes it fail on Linux musl. The
 * TypeScript artifact itself is platform-neutral across libc: the
 * `@effect/tsgo-<platform>-<arch>` package lists it in `lib/upstream.json`
 * under `components.typescript` and ships it at
 * `artifacts/typescript/<version>/tsc`, keyed by the installed
 * `@typescript/typescript-<platform>-<arch>` version.
 */
function resolveEffectTsgoTypeScriptArtifact(from: string | URL): string {
  const projectRequire = createRequire(from);
  const effectTsgoPackageJsonPath = projectRequire.resolve(
    `${EFFECT_TSGO_PACKAGE}/package.json`,
  );
  const platformTarget = `${process.platform}-${process.arch}`;
  const effectTsgoPlatformPackageJsonPath = createRequire(
    effectTsgoPackageJsonPath,
  ).resolve(`${EFFECT_TSGO_PACKAGE}-${platformTarget}/package.json`);
  const upstream = readJson<EffectTsgoUpstreamManifest>(
    join(dirname(effectTsgoPlatformPackageJsonPath), 'lib', 'upstream.json'),
  );
  const packagedTypeScriptVersions = upstream.components?.typescript ?? {};

  for (const packageName of NATIVE_TYPESCRIPT_PACKAGES) {
    const typescript = resolvePackageVersion(projectRequire, packageName);
    const major = typescript && /^\s*(\d+)/u.exec(typescript.version);
    if (!typescript || !major || Number(major[1]) < 7) {
      continue;
    }

    const typescriptPlatform = resolvePackageVersion(
      createRequire(typescript.packageJsonPath),
      `@typescript/typescript-${platformTarget}`,
    );
    if (
      !typescriptPlatform ||
      !Object.hasOwn(packagedTypeScriptVersions, typescriptPlatform.version)
    ) {
      break;
    }

    return join(
      dirname(effectTsgoPlatformPackageJsonPath),
      'artifacts',
      'typescript',
      typescriptPlatform.version,
      process.platform === 'win32' ? 'tsc.exe' : 'tsc',
    );
  }

  throw new Error(EFFECT_TSGO_RESOLUTION_ERROR);
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
    return resolveExecutableEffectTsgoCompiler(
      resolveEffectTsgoTypeScriptArtifact(options.from),
    );
  } catch {
    // Use one stable error for package, platform-package, and artifact failures.
  }

  throw new Error(EFFECT_TSGO_RESOLUTION_ERROR);
}
