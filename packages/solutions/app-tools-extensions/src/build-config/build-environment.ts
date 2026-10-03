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

// Resolve the canonical private CJS bridge through the installed owner's actual
// public name, including the publisher's renamed standalone package.
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

type EnvironmentLeaseRegistry = Readonly<{
  acquire: (name: string, value: string) => () => void;
  brand: symbol;
}>;

type LifecycleHookName = (typeof LIFECYCLE_HOOK_NAMES)[number];

type LifecycleHook = {
  tap: (options: { name: string; stage: number }, handler: () => void) => void;
};

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createEnvironmentLeaseRegistry(): EnvironmentLeaseRegistry {
  const environmentLeases = new Map<string, EnvironmentLease>();

  return Object.freeze({
    acquire(name: string, value: string): () => void {
      let lease = environmentLeases.get(name);

      if (lease) {
        if (lease.value !== value) {
          throw new Error(
            `Build config environment "${name}" already has an active lease for a different value.`,
          );
        }
        if (process.env[name] !== lease.value) {
          throw new Error(
            `Build config environment lease for "${name}" lost ownership before another lease was acquired.`,
          );
        }
      } else {
        lease = {
          originalValue: process.env[name],
          owners: new Set(),
          value,
        };
        process.env[name] = value;
        environmentLeases.set(name, lease);
      }

      const owner = Symbol(name);
      lease.owners.add(owner);
      let released = false;

      return () => {
        if (released) {
          return;
        }

        if (environmentLeases.get(name) !== lease || !lease.owners.has(owner)) {
          throw new Error(
            `Build config environment lease for "${name}" cannot be restored because its ownership record was lost.`,
          );
        }

        released = true;
        const lostOwnership = process.env[name] !== lease.value;
        lease.owners.delete(owner);

        if (lease.owners.size === 0) {
          environmentLeases.delete(name);
          restoreEnvironment(name, lease.originalValue);
        } else if (lostOwnership) {
          process.env[name] = lease.value;
        }

        if (lostOwnership) {
          throw new Error(
            `Build config environment lease for "${name}" lost ownership before restoration.`,
          );
        }
      };
    },
    brand: ENVIRONMENT_LEASE_REGISTRY_BRAND,
  });
}

function getEnvironmentLeaseRegistry(): EnvironmentLeaseRegistry {
  const descriptor = Object.getOwnPropertyDescriptor(
    process,
    ENVIRONMENT_LEASE_REGISTRY_KEY,
  );

  if (descriptor) {
    const registry = descriptor.value as
      | Partial<EnvironmentLeaseRegistry>
      | undefined;
    if (
      descriptor.configurable ||
      descriptor.enumerable ||
      descriptor.writable ||
      registry?.brand !== ENVIRONMENT_LEASE_REGISTRY_BRAND ||
      typeof registry.acquire !== 'function'
    ) {
      throw new Error(
        'The process-global build config environment lease registry is occupied by an incompatible value.',
      );
    }
    return registry as EnvironmentLeaseRegistry;
  }

  const registry = createEnvironmentLeaseRegistry();
  Object.defineProperty(process, ENVIRONMENT_LEASE_REGISTRY_KEY, {
    configurable: false,
    enumerable: false,
    value: registry,
    writable: false,
  });
  return registry;
}

function acquireEnvironmentLease(name: string, value: string): () => void {
  return getEnvironmentLeaseRegistry().acquire(name, value);
}

function releaseAfterFailure(
  release: () => void,
  originalError: unknown,
): never {
  try {
    release();
  } catch (restorationError) {
    throw new AggregateError(
      [originalError, restorationError],
      'Build config environment setup and restoration both failed.',
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

/**
 * Runs a Rspack config setup under a leased environment value. The lease is
 * restored when that compiler reaches any supported terminal hook.
 */
export function withBuildConfigEnvironment<
  Config extends { plugins?: Rspack.Plugin[] },
  SetupArguments extends unknown[],
>(
  name: string,
  value: string,
  setup: (
    config: Config,
    ...args: SetupArguments
  ) => Config | void | Promise<Config | void>,
): (config: Config, ...args: SetupArguments) => Promise<Config> {
  return async (config, ...args) => {
    const release = acquireEnvironmentLease(name, value);

    try {
      const configured = (await setup(config, ...args)) ?? config;
      configured.plugins = [
        ...(configured.plugins ?? []),
        new BuildConfigEnvironmentLeasePlugin(release),
      ];
      return configured;
    } catch (error) {
      releaseAfterFailure(release, error);
    }
  };
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
      throw new Error('Effect TS-Go CLI returned an empty compiler path');
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
