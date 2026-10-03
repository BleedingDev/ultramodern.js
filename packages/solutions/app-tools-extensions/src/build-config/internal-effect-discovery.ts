import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, type URL } from 'node:url';

const invokeProviderCli = execFileSync;
const owningNodeExecutable = process.execPath;
const EFFECT_TSGO_PACKAGE = '@effect/tsgo';
const EFFECT_TSGO_BIN = 'effect-tsgo';
const NATIVE_TYPESCRIPT_PACKAGES = ['typescript', '@typescript/native'];
type PackageJson = { bin?: Record<string, string> | string; version?: string };
export interface EffectCompilerInstallation {
  readonly from: string;
  readonly cliPath: string;
  readonly backendDirectory: string;
}
type DiscoveryObserver = (
  installation: EffectCompilerInstallation,
  invokeValidatedDiscovery: () => string,
) => string;
let discoveryObserver: DiscoveryObserver | undefined;
const failureStages = new WeakMap<object, string>();

/** Private owning-worker bridge. Existing observers cannot be recovered/replaced. */
export function installEffectCompilerDiscoveryObserver(
  observer: DiscoveryObserver,
): () => void {
  if (discoveryObserver)
    throw new Error('Effect compiler discovery already has an observer');
  if (typeof observer !== 'function')
    throw new TypeError(
      'Effect compiler discovery observer must be a function',
    );
  discoveryObserver = observer;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (discoveryObserver !== observer)
      throw new Error('Effect compiler discovery observer lost ownership');
    discoveryObserver = undefined;
  };
}

export function effectCompilerDiscoveryFailureStage(
  error: unknown,
): string | undefined {
  return error && typeof error === 'object'
    ? failureStages.get(error)
    : undefined;
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
    throw new Error(
      `Resolved ${EFFECT_TSGO_PACKAGE} package has no ${EFFECT_TSGO_BIN} bin: ${packageJsonPath}`,
    );
  }

  return resolve(dirname(packageJsonPath), bin);
}

function isAbsentNativeTypeScriptPackage(
  projectRequire: NodeJS.Require,
  from: string | URL,
  packageName: string,
  error: unknown,
): boolean {
  const filename =
    typeof from === 'string' && !from.startsWith('file:')
      ? from
      : fileURLToPath(from);
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'MODULE_NOT_FOUND' ||
    ('path' in error && error.path !== undefined) ||
    error.message.split('\n')[0] !==
      `Cannot find module '${packageName}/package.json'` ||
    !('requireStack' in error) ||
    !Array.isArray(error.requireStack) ||
    error.requireStack[0] !== filename
  ) {
    return false;
  }
  for (const searchDirectory of projectRequire.resolve.paths(packageName) ??
    []) {
    try {
      lstatSync(join(searchDirectory, packageName));
      return false;
    } catch (presenceError) {
      if (
        !(presenceError instanceof Error) ||
        !('code' in presenceError) ||
        !['ENOENT', 'ENOTDIR'].includes(String(presenceError.code))
      ) {
        throw presenceError;
      }
    }
  }
  return true;
}

function resolveNativeTypeScriptPackage(from: string | URL): string {
  const projectRequire = createRequire(from);
  for (const packageName of NATIVE_TYPESCRIPT_PACKAGES) {
    let packageJsonPath: string;
    try {
      packageJsonPath = projectRequire.resolve(`${packageName}/package.json`);
    } catch (error) {
      if (
        isAbsentNativeTypeScriptPackage(
          projectRequire,
          from,
          packageName,
          error,
        )
      ) {
        continue;
      }
      throw error;
    }
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, 'utf-8'),
    ) as PackageJson;
    const major = packageJson.version?.match(
      /^(\d+)\.\d+\.\d+(?:[-+].*)?$/u,
    )?.[1];
    if (!major) {
      throw new Error(
        `Resolved TypeScript package has no valid version: ${packageJsonPath}`,
      );
    }
    if (Number(major) >= 7) {
      return packageJsonPath;
    }
  }
  throw new Error(
    `No native TypeScript backend is installed for ${String(from)}. Install typescript >=7 or @typescript/native.`,
  );
}

function resolveNativeTypeScriptDirectory(from: string | URL): string {
  const packageJsonPath = resolveNativeTypeScriptPackage(from);
  const directory = dirname(packageJsonPath);
  // Effect discovers its backend from cwd, independently of the parent's
  // module hooks. Bind discovery to the selected backend's own installation.
  const discoveryPackage = resolveNativeTypeScriptPackage(
    join(directory, '__ultramodern_effect_backend__.cjs'),
  );
  if (realpathSync(discoveryPackage) !== realpathSync(packageJsonPath)) {
    throw new Error(
      `Effect discovery would select a different native TypeScript installation from ${directory}: ${discoveryPackage}`,
    );
  }
  return directory;
}

/** Resolves without executing a provider, allowing the worker to bind its cohort first. */
export function resolveEffectCompilerInstallation(
  from: string | URL,
): EffectCompilerInstallation {
  let stage = 'Package CLI resolution';
  try {
    const cliPath = resolveEffectTsgoCli(from);
    stage = 'Native TypeScript package resolution';
    const backendDirectory = resolveNativeTypeScriptDirectory(from);
    return Object.freeze({
      from:
        typeof from === 'string' && !from.startsWith('file:')
          ? from
          : fileURLToPath(from),
      cliPath: realpathSync(cliPath),
      backendDirectory: realpathSync(backendDirectory),
    });
  } catch (error) {
    if (error && typeof error === 'object') failureStages.set(error, stage);
    throw error;
  }
}

/** Owns exactly the installed provider/backend resolution and fixed CLI query. */
export function resolveInstalledEffectCompiler(from: string | URL): string {
  let stage = 'Package CLI resolution';
  try {
    const installation = resolveEffectCompilerInstallation(from);
    stage = 'Compiler backend lookup';
    const environment: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).map(([name, value]) => [
        name,
        value === undefined ? undefined : String(value),
      ]),
    );
    if (discoveryObserver && environment.NODE_OPTIONS) {
      throw new Error(
        'Evaluator Effect discovery does not support authored NODE_OPTIONS',
      );
    }
    const invoke = () =>
      invokeProviderCli(
        owningNodeExecutable,
        [installation.cliPath, 'get-exe-path'],
        {
          cwd: installation.backendDirectory,
          encoding: 'utf8',
          env: environment,
        },
      );
    return discoveryObserver
      ? discoveryObserver(installation, invoke)
      : invoke();
  } catch (error) {
    if (error && typeof error === 'object' && !failureStages.has(error))
      failureStages.set(error, stage);
    throw error;
  }
}
