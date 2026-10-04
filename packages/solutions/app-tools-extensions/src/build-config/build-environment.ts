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
import { createRequire, findPackageJSON } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, type URL } from 'node:url';
import type { Rspack } from '@rsbuild/core';

// CJS and ESM consumers share the selected-cohort validator in one owning
// module, including packages whose public name changes during publication.
const owningModuleFile =
  process.env.MODERN_LIB_FORMAT === 'esm'
    ? fileURLToPath(import.meta.url)
    : __filename;
const owningManifest = findPackageJSON(owningModuleFile, owningModuleFile);
if (!owningManifest)
  throw new Error('Cannot find owning build-config package manifest');
const owningName: unknown = JSON.parse(
  readFileSync(owningManifest, 'utf8'),
).name;
if (typeof owningName !== 'string' || owningName.length === 0) {
  throw new Error(
    `Invalid owning build-config package name: ${owningManifest}`,
  );
}
const {
  effectCompilerDiscoveryFailureStage,
  resolveInstalledEffectCompiler,
}: typeof import('./internal-effect-discovery') = createRequire(
  owningModuleFile,
)(`${owningName}/internal-effect-discovery`);

const EFFECT_TSGO_RESOLUTION_ERROR =
  'Unable to resolve the Effect TS-Go compiler. Install "@effect/tsgo" and a native TypeScript backend for this build config, or set EFFECT_TSGO_BIN.';
const executableEffectTsgoCompilers = new Map<string, string>();

function effectTsgoResolutionError(
  cause: unknown,
  stage: string,
  from: string | URL,
): Error {
  const detail =
    cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return new Error(
    `${EFFECT_TSGO_RESOLUTION_ERROR}\n${stage} failed for ${String(from)}: ${detail}`,
    { cause },
  );
}

const BUILD_CONFIG_ENVIRONMENT_PLUGIN =
  'ModernJsBuildConfigEnvironmentLeasePlugin';
const ENVIRONMENT_LEASE_REGISTRY_KEY = Symbol.for(
  '@modern-js/app-tools/build-config-environment-lease-registry/v1',
);
const ENVIRONMENT_LEASE_REGISTRY_BRAND = Symbol.for(
  '@modern-js/app-tools/build-config-environment-lease-registry-brand/v1',
);
const LIFECYCLE_HOOK_NAMES = [
  'run',
  'watchRun',
  'afterDone',
  'failed',
  'shutdown',
  'watchClose',
] as const;

type EnvironmentLease = {
  originalValue: string | undefined;
  owners: Set<symbol>;
  value: string;
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

  throw originalError;
}

class BuildConfigEnvironmentLeasePlugin {
  constructor(private readonly release: () => void) {}

  apply(compiler: Rspack.Compiler): void {
    const hooks = compiler.hooks as unknown as Record<
      string,
      LifecycleHook | undefined
    >;

    try {
      const lifecycleHooks = {} as Record<LifecycleHookName, LifecycleHook>;
      for (const hookName of LIFECYCLE_HOOK_NAMES) {
        const hook = hooks[hookName];
        if (!hook || typeof hook.tap !== 'function') {
          throw new Error(
            `Rspack does not expose the "${hookName}" lifecycle hook required to restore build config environment leases.`,
          );
        }
        lifecycleHooks[hookName] = hook;
      }

      let mode: 'pending' | 'run' | 'watch' = 'pending';
      const modeTap = {
        name: BUILD_CONFIG_ENVIRONMENT_PLUGIN,
        stage: Number.MIN_SAFE_INTEGER,
      };
      const releaseTap = {
        name: BUILD_CONFIG_ENVIRONMENT_PLUGIN,
        stage: Number.MAX_SAFE_INTEGER,
      };
      const releaseAfterOneShot = () => {
        if (mode !== 'watch' && compiler.watchMode !== true) {
          this.release();
        }
      };

      lifecycleHooks.run.tap(modeTap, () => {
        mode = 'run';
      });
      lifecycleHooks.watchRun.tap(modeTap, () => {
        mode = 'watch';
      });
      lifecycleHooks.afterDone.tap(releaseTap, releaseAfterOneShot);
      lifecycleHooks.failed.tap(releaseTap, releaseAfterOneShot);
      lifecycleHooks.shutdown.tap(releaseTap, this.release);
      lifecycleHooks.watchClose.tap(releaseTap, this.release);
    } catch (error) {
      releaseAfterFailure(this.release, error);
    }
  }
}

function resolveExecutableEffectTsgoCompiler(compilerPath: string): string {
  if (process.platform === 'win32') {
    return compilerPath;
  }

  const sourcePath = realpathSync(compilerPath);
  const source = lstatSync(sourcePath);
  if (!source.isFile()) {
    throw new Error(
      `Effect TS-Go compiler path is not a regular file: ${sourcePath}`,
    );
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
    } catch (cause) {
      throw effectTsgoResolutionError(
        cause,
        'Configured compiler validation',
        options.from,
      );
    }
  }

  let stage = 'Package CLI resolution';
  try {
    const compiler = resolveInstalledEffectCompiler(options.from).trim();
    stage = 'Compiler backend lookup';

    if (!compiler) {
      throw new Error('Effect TS-Go discovery returned an empty compiler path');
    }
    stage = 'Compiler executable validation';
    return resolveExecutableEffectTsgoCompiler(compiler);
  } catch (cause) {
    throw effectTsgoResolutionError(
      cause,
      effectCompilerDiscoveryFailureStage(cause) ?? stage,
      options.from,
    );
  }
}
