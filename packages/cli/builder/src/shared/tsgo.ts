import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { json5 } from '@modern-js/utils';
import type { PluginTypeCheckerOptions } from '@rsbuild/plugin-type-check';

type TsCheckerChain = NonNullable<PluginTypeCheckerOptions['tsCheckerOptions']>;
type TsCheckerFn = Extract<TsCheckerChain, (config: never) => unknown>;
export type TsCheckerOptions = Parameters<TsCheckerFn>[0];
type TsConfigJson = {
  extends?: string | string[];
  compilerOptions?: Record<string, any>;
};

const builderRequire = createRequire(import.meta.url);

const STABLE_TSGO_PACKAGE = 'typescript/package.json';
const NATIVE_PREVIEW_TSGO_PACKAGE = '@typescript/native-preview/package.json';
const TSGO_CHECKER_DIR = path.join('.modern-js', 'tsgo');

const tryResolve = (request: string, rootPath: string): string | undefined => {
  try {
    return builderRequire.resolve(request, { paths: [rootPath] });
  } catch {
    return undefined;
  }
};

const readPackageMajorVersion = (
  packageJsonPath: string,
): number | undefined => {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8'),
    ) as {
      version?: unknown;
    };
    const major = Number.parseInt(
      String(packageJson.version).split('.')[0],
      10,
    );
    return Number.isFinite(major) ? major : undefined;
  } catch {
    return undefined;
  }
};

const resolveTsgoPackagePath = (rootPath: string): string => {
  const stableTypeScriptPath = tryResolve(STABLE_TSGO_PACKAGE, rootPath);
  if (
    stableTypeScriptPath &&
    (readPackageMajorVersion(stableTypeScriptPath) ?? 0) >= 7
  ) {
    return stableTypeScriptPath;
  }

  return (
    tryResolve(NATIVE_PREVIEW_TSGO_PACKAGE, rootPath) ??
    builderRequire.resolve(NATIVE_PREVIEW_TSGO_PACKAGE)
  );
};

const toPosixPath = (input: string): string => input.replaceAll(path.sep, '/');

const asTsConfigPath = (request: string): string[] => {
  if (path.extname(request)) {
    return [request];
  }

  return [request, `${request}.json`];
};

const resolveExtends = (
  request: string,
  configDirectory: string,
): string | undefined => {
  const configRequire = createRequire(
    path.join(configDirectory, 'tsconfig.json'),
  );

  for (const candidate of asTsConfigPath(request)) {
    if (candidate.startsWith('.') || path.isAbsolute(candidate)) {
      const resolved = path.resolve(configDirectory, candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
      continue;
    }

    try {
      return configRequire.resolve(candidate);
    } catch {
      // Try the next supported TypeScript extends shape.
    }
  }

  return undefined;
};

const readTsConfig = (
  configFile: string,
  visited = new Set<string>(),
): TsConfigJson => {
  if (visited.has(configFile) || !fs.existsSync(configFile)) {
    return {};
  }
  visited.add(configFile);

  const config = json5.parse(
    fs.readFileSync(configFile, 'utf8'),
  ) as TsConfigJson;
  const configDirectory = path.dirname(configFile);
  const extendsList = Array.isArray(config.extends)
    ? config.extends
    : config.extends
      ? [config.extends]
      : [];

  const baseConfig = extendsList.reduce<TsConfigJson>((merged, request) => {
    const resolved = resolveExtends(request, configDirectory);
    if (!resolved) {
      return merged;
    }
    const parentConfig = readTsConfig(resolved, visited);
    return {
      ...merged,
      compilerOptions: {
        ...(merged.compilerOptions ?? {}),
        ...(parentConfig.compilerOptions ?? {}),
      },
    };
  }, {});

  return {
    ...baseConfig,
    compilerOptions: {
      ...(baseConfig.compilerOptions ?? {}),
      ...(config.compilerOptions ?? {}),
    },
  };
};

const toRelativeConfigPath = (fromDirectory: string, target: string) => {
  const relative = toPosixPath(path.relative(fromDirectory, target));
  if (relative.startsWith('.')) {
    return relative;
  }
  return `./${relative}`;
};

const writeFileIfChanged = (file: string, content: string) => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    return;
  }
  fs.writeFileSync(file, content);
};

const createTsgoCheckerConfig = (configFile: string): string => {
  const configDirectory = path.dirname(configFile);
  const checkerConfigDirectory = path.join(configDirectory, TSGO_CHECKER_DIR);
  const hash = createHash('sha1').update(configFile).digest('hex').slice(0, 10);
  const checkerConfigFile = path.join(
    checkerConfigDirectory,
    `tsconfig.${hash}.json`,
  );
  const tsConfig = readTsConfig(configFile);
  const compilerOptions: Record<string, unknown> = {
    baseUrl: null,
  };
  const moduleResolution = String(
    tsConfig.compilerOptions?.moduleResolution,
  ).toLowerCase();

  if (['node', 'node10'].includes(moduleResolution)) {
    compilerOptions.moduleResolution = null;
  }

  const checkerConfig = {
    extends: toRelativeConfigPath(checkerConfigDirectory, configFile),
    compilerOptions,
  };

  fs.mkdirSync(checkerConfigDirectory, { recursive: true });
  writeFileIfChanged(
    checkerConfigFile,
    `${JSON.stringify(checkerConfig, null, 2)}\n`,
  );

  return checkerConfigFile;
};

const normalizeTsgoConfig = (config: TsCheckerOptions, rootPath: string) => {
  const { typescript } = config;
  if (typescript?.tsgo === false) {
    return config;
  }

  const compilerOptions = {
    ...(typescript?.configOverwrite?.compilerOptions ?? {}),
    // The checker worker receives this option through JSON serialization.
    // `null` survives that boundary and TypeScript treats it as absent.
    baseUrl: null,
  };

  if (
    ['node', 'node10'].includes(
      String(compilerOptions.moduleResolution).toLowerCase(),
    )
  ) {
    compilerOptions.moduleResolution = null;
  }

  config.typescript = {
    ...typescript,
    configOverwrite: {
      ...(typescript?.configOverwrite ?? {}),
      compilerOptions,
    },
  };

  if (typescript?.configFile) {
    config.typescript.configFile = createTsgoCheckerConfig(
      path.resolve(rootPath, typescript.configFile),
    );
  }

  return config;
};

/**
 * Type checking runs on TypeScript Go (`tsgo`) by default. The checker
 * prefers the project's stable TypeScript 7 package, then falls back to
 * `@typescript/native-preview` for projects still on the preview lane.
 * Set `tools.tsChecker.typescript.tsgo: false` to use the classic checker.
 */
export const withTsgoDefaults = (
  userOptions: TsCheckerChain | undefined,
  rootPath: string,
): TsCheckerChain => {
  const tsgoPath = resolveTsgoPackagePath(rootPath);
  const userChain = userOptions
    ? Array.isArray(userOptions)
      ? userOptions
      : [userOptions]
    : [];
  return [
    { typescript: { tsgo: true, typescriptPath: tsgoPath } },
    ...userChain,
    (config: TsCheckerOptions) => {
      const { typescript } = config;
      // A user opting out of tsgo gets the classic checker on the project's
      // own `typescript` install instead of the injected tsgo path.
      if (
        typescript?.tsgo === false &&
        typescript.typescriptPath === tsgoPath
      ) {
        typescript.typescriptPath = tryResolve('typescript', rootPath);
      }
      return normalizeTsgoConfig(config, rootPath);
    },
  ];
};
