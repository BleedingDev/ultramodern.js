import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, type URL } from 'node:url';

const EFFECT_TSGO_PACKAGE = '@effect/tsgo';
const EFFECT_TSGO_BIN = 'effect-tsgo';
const NATIVE_TYPESCRIPT_PACKAGES = ['typescript', '@typescript/native'];
type PackageJson = {
  name?: string;
  bin?: Record<string, string> | string;
  version?: string;
  gitHead?: string;
};
const failureStages = new WeakMap<object, string>();
export interface EffectCompilerSelection {
  readonly from: string;
  readonly cliPath: string;
  readonly backendManifest: string;
  readonly nativePlatformManifest: string;
  readonly effectPlatformManifest: string;
  readonly compilerPath: string;
}

export function effectCompilerDiscoveryFailureStage(
  error: unknown,
): string | undefined {
  return error && typeof error === 'object'
    ? failureStages.get(error)
    : undefined;
}

function resolveEffectTsgoPackage(from: string | URL): {
  packageJsonPath: string;
  packageJson: PackageJson;
  cliPath: string;
} {
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

  const cliPath = realpathSync(resolve(dirname(packageJsonPath), bin));
  if (!lstatSync(cliPath).isFile())
    throw new Error(`Effect TS-Go CLI is not a regular file: ${cliPath}`);
  return { packageJsonPath, packageJson, cliPath };
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

function resolveNativeTypeScriptManifest(from: string | URL): string {
  const packageJsonPath = resolveNativeTypeScriptPackage(from);
  const directory = dirname(packageJsonPath);
  // Keep the selected backend bound to its own installation, including the
  // canonical-package precedence used by the provider.
  const discoveryPackage = resolveNativeTypeScriptPackage(
    join(directory, '__ultramodern_effect_backend__.cjs'),
  );
  if (realpathSync(discoveryPackage) !== realpathSync(packageJsonPath)) {
    throw new Error(
      `Effect discovery would select a different native TypeScript installation from ${directory}: ${discoveryPackage}`,
    );
  }
  return packageJsonPath;
}

function readCompilerArtifact(filename: string): string {
  const canonicalPath = realpathSync(filename);
  const stats = lstatSync(canonicalPath);
  if (!stats.isFile())
    throw new Error(`Compiler artifact is not a regular file: ${filename}`);
  if (stats.size === 0)
    throw new Error(`Compiler artifact is empty: ${filename}`);
  return canonicalPath;
}

/** Selects the exact native replacement without invoking the provider. */
export function resolveEffectCompilerSelection(
  from: string | URL,
): EffectCompilerSelection {
  let stage = 'Package CLI resolution';
  try {
    const effect = resolveEffectTsgoPackage(from);
    stage = 'Native TypeScript package resolution';
    const typeScriptManifest = resolveNativeTypeScriptManifest(from);
    const typeScript = JSON.parse(
      readFileSync(typeScriptManifest, 'utf8'),
    ) as PackageJson;
    const nativeName = `@typescript/typescript-${process.platform}-${process.arch}`;
    const nativeManifest = createRequire(typeScriptManifest).resolve(
      `${nativeName}/package.json`,
    );
    const native = JSON.parse(
      readFileSync(nativeManifest, 'utf8'),
    ) as PackageJson;
    if (
      native.name !== nativeName ||
      native.version !== typeScript.version ||
      typeof native.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(native.version) ||
      typeof native.gitHead !== 'string' ||
      !/^[a-f\d]{40}$/u.test(native.gitHead) ||
      native.gitHead !== typeScript.gitHead
    ) {
      throw new Error(
        `Native TypeScript platform does not match its selected package: ${nativeManifest}`,
      );
    }
    const binaryName = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
    readCompilerArtifact(join(dirname(nativeManifest), 'lib', binaryName));
    stage = 'Compiler backend lookup';
    const effectName = `@effect/tsgo-${process.platform}-${process.arch}`;
    const effectManifest = createRequire(effect.cliPath).resolve(
      `${effectName}/package.json`,
    );
    const platform = JSON.parse(
      readFileSync(effectManifest, 'utf8'),
    ) as PackageJson;
    if (
      platform.name !== effectName ||
      typeof effect.packageJson.version !== 'string' ||
      platform.version !== effect.packageJson.version
    ) {
      throw new Error(
        `Effect platform does not match its selected provider: ${effectManifest}`,
      );
    }
    const metadataPath = join(dirname(effectManifest), 'lib', 'upstream.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
      schemaVersion?: number;
      components?: {
        typescript?: Record<string, { gitHead?: string; provider?: string }>;
      };
    };
    const component = metadata.components?.typescript?.[native.version];
    if (
      metadata.schemaVersion !== 5 ||
      component?.provider !== 'typescript-go' ||
      component.gitHead !== native.gitHead
    ) {
      throw new Error(
        `Effect replacement metadata does not match the selected native TypeScript backend: ${metadataPath}`,
      );
    }
    const compilerPath = readCompilerArtifact(
      join(
        dirname(effectManifest),
        'artifacts',
        'typescript',
        native.version,
        binaryName,
      ),
    );
    return Object.freeze({
      from:
        typeof from === 'string' && !from.startsWith('file:')
          ? from
          : fileURLToPath(from),
      cliPath: effect.cliPath,
      backendManifest: realpathSync(typeScriptManifest),
      nativePlatformManifest: realpathSync(nativeManifest),
      effectPlatformManifest: realpathSync(effectManifest),
      compilerPath,
    });
  } catch (error) {
    if (error && typeof error === 'object' && !failureStages.has(error))
      failureStages.set(error, stage);
    throw error;
  }
}

export function resolveInstalledEffectCompiler(from: string | URL): string {
  return resolveEffectCompilerSelection(from).compilerPath;
}
