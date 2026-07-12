import { execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { URL } from 'node:url';
import type { Rspack } from '@rsbuild/core';

const EFFECT_TSGO_PACKAGE = '@effect/tsgo';
const EFFECT_TSGO_BIN = 'effect-tsgo';
const EFFECT_TSGO_RESOLUTION_ERROR =
  'Unable to resolve the Effect TS-Go compiler. Install "@effect/tsgo" and a native TypeScript backend for this build config, or set EFFECT_TSGO_BIN.';
const executableEffectTsgoCompilers = new Map<string, string>();
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

type PackageJson = {
  bin?: Record<string, string> | string;
};

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
    return cachedCompiler;
  }

  const compilerDirectory = mkdtempSync(
    join(tmpdir(), 'modern-js-effect-tsgo-'),
  );
  const executableCompiler = join(compilerDirectory, basename(sourcePath));
  copyFileSync(sourcePath, executableCompiler, constants.COPYFILE_EXCL);
  chmodSync(executableCompiler, 0o700);
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
