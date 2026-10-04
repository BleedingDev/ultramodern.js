import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { json5 } from '@modern-js/utils';
import type { PluginTypeCheckerOptions } from '@rsbuild/plugin-type-check';

type TsCheckerChain = NonNullable<PluginTypeCheckerOptions['tsCheckerOptions']>;
type TsCheckerFn = Extract<TsCheckerChain, (config: never) => unknown>;
export type TsCheckerOptions = Parameters<TsCheckerFn>[0];
type TsConfigProjectReference = { path: string } & Record<string, unknown>;
type TsConfigJson = {
  extends?: string | string[];
  compilerOptions?: Record<string, any>;
  references?: TsConfigProjectReference[];
};

const builderRequire = createRequire(import.meta.url);

const STABLE_TSGO_PACKAGE = 'typescript/package.json';
const TSGO_CHECKER_DIR = path.join('.modern-js', 'tsgo');

const tryResolve = (request: string, rootPath: string): string | undefined => {
  try {
    return builderRequire.resolve(request, { paths: [rootPath] });
  } catch {
    return undefined;
  }
};

const resolveTsgoPackagePath = (rootPath: string): string => {
  const packageJsonPath =
    tryResolve(STABLE_TSGO_PACKAGE, rootPath) ??
    builderRequire.resolve(STABLE_TSGO_PACKAGE);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    name?: unknown;
    version?: unknown;
  };
  if (packageJson.name !== 'typescript' || packageJson.version !== '7.0.2') {
    throw new Error(
      `The native type checker requires typescript@7.0.2; found ${String(packageJson.name)}@${String(packageJson.version)} at ${packageJsonPath}.`,
    );
  }
  return packageJsonPath;
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

/**
 * Compiler options whose value is a path resolved relative to the config file
 * that declares them.
 *
 * The generated checker config lives in `.modern-js/tsgo/`, not beside the
 * project config it extends, so an inherited relative path must already be
 * absolute by the time it is written out. Leaving `rootDir` relative made the
 * native checker resolve it against the generated directory and reject every
 * real source file with TS6059.
 */
const PATH_COMPILER_OPTIONS = ['rootDir', 'outDir', 'declarationDir'] as const;

const absolutiseConfigPaths = (
  compilerOptions: Record<string, any> | undefined,
  configDirectory: string,
): Record<string, any> => {
  if (!compilerOptions) {
    return {};
  }

  const resolved: Record<string, any> = { ...compilerOptions };
  for (const option of PATH_COMPILER_OPTIONS) {
    const value = resolved[option];
    if (typeof value === 'string' && !path.isAbsolute(value)) {
      resolved[option] = path.resolve(configDirectory, value);
    }
  }
  return resolved;
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
      ...absolutiseConfigPaths(config.compilerOptions, configDirectory),
    },
  };
};

/**
 * Project references are the one top-level tsconfig property TypeScript never
 * inherits through `extends`, so the generated checker config has to restate
 * them. They come from the project's own config only (a base config's
 * references would not apply to the project either), with each path resolved
 * against the config that declares it.
 *
 * Without them a referenced sibling project stops being a project boundary:
 * its sources are pulled into this program and type-checked against this
 * program's globals (TanStack's `Register` route tree, for example) instead of
 * being redirected to the sibling's own declarations.
 */
const readProjectReferences = (
  configFile: string,
): TsConfigProjectReference[] => {
  if (!fs.existsSync(configFile)) {
    return [];
  }
  const config = json5.parse(
    fs.readFileSync(configFile, 'utf8'),
  ) as TsConfigJson;
  if (!Array.isArray(config.references)) {
    return [];
  }
  const configDirectory = path.dirname(configFile);
  return config.references
    .filter(
      (reference): reference is TsConfigProjectReference =>
        typeof reference?.path === 'string',
    )
    .map(reference => ({
      ...reference,
      path: toPosixPath(path.resolve(configDirectory, reference.path)),
    }));
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

const defaultTsgoCheckerConfigFile = (configFile: string): string => {
  const hash = createHash('sha1').update(configFile).digest('hex').slice(0, 10);
  return path.join(
    path.dirname(configFile),
    TSGO_CHECKER_DIR,
    `tsconfig.${hash}.json`,
  );
};

const createTsgoCheckerConfig = (
  configFile: string,
  checkerConfigFile: string = defaultTsgoCheckerConfigFile(configFile),
): string => {
  const configDirectory = path.dirname(configFile);
  const checkerConfigDirectory = path.dirname(checkerConfigFile);
  const tsConfig = readTsConfig(configFile);
  const compilerOptions: Record<string, unknown> = {
    baseUrl: null,
  };

  // `rootDir` must name the project's own directory, never the generated
  // config's. An explicit value has already been made absolute while the
  // extends chain was merged; with `composite` and no explicit value
  // TypeScript defaults `rootDir` to the directory holding the config, which
  // here would be `.modern-js/tsgo/` and would put every source file outside
  // the root (TS6059). Pin what the default would have produced in place.
  const declaredRootDir = tsConfig.compilerOptions?.rootDir;
  if (typeof declaredRootDir === 'string') {
    compilerOptions.rootDir = toPosixPath(declaredRootDir);
  } else if (tsConfig.compilerOptions?.composite === true) {
    compilerOptions.rootDir = toPosixPath(configDirectory);
  }
  const moduleResolution = String(
    tsConfig.compilerOptions?.moduleResolution,
  ).toLowerCase();

  if (['node', 'node10'].includes(moduleResolution)) {
    compilerOptions.moduleResolution = null;
  }

  const references = readProjectReferences(configFile);
  const checkerConfig = {
    extends: toRelativeConfigPath(checkerConfigDirectory, configFile),
    compilerOptions,
    ...(references.length > 0 ? { references } : {}),
  };

  fs.mkdirSync(checkerConfigDirectory, { recursive: true });
  writeFileIfChanged(
    checkerConfigFile,
    `${JSON.stringify(checkerConfig, null, 2)}\n`,
  );

  return checkerConfigFile;
};

/**
 * Regenerate a checker config from the project config it `extends`.
 *
 * The generated file is written once, at builder configuration; everything it
 * inherits through `extends` is read fresh by the compiler on every check, but
 * the values it has to restate (`references`, the pinned `rootDir`, the
 * `moduleResolution` override) would otherwise stay frozen for the life of a
 * `modern dev` session. The checker calls this before each run so an edit to
 * the project's tsconfig - adding, removing or retargeting a project reference -
 * takes effect on the next compilation instead of the next restart.
 *
 * Returns the project config the checker config was derived from, so the caller
 * can watch it; `undefined` when the file is not a generated checker config.
 */
export const refreshTsgoCheckerConfig = (
  checkerConfigFile: string,
): string | undefined => {
  const checkerConfigDirectory = path.dirname(checkerConfigFile);
  if (
    path.basename(checkerConfigDirectory) !== 'tsgo' ||
    path.basename(path.dirname(checkerConfigDirectory)) !== '.modern-js' ||
    !fs.existsSync(checkerConfigFile)
  ) {
    return undefined;
  }
  let checkerConfig: TsConfigJson;
  try {
    checkerConfig = json5.parse(
      fs.readFileSync(checkerConfigFile, 'utf8'),
    ) as TsConfigJson;
  } catch {
    // Not a generated checker config after all; nothing to derive it from.
    return undefined;
  }
  if (typeof checkerConfig.extends !== 'string') {
    return undefined;
  }
  const projectConfigFile = path.resolve(
    checkerConfigDirectory,
    checkerConfig.extends,
  );
  // Register-before-parse: the project config path is returned even while the
  // file is missing or malformed mid-edit, so the caller keeps watching it and
  // the next save re-triggers the compilation. The generated file is left as
  // it was, and the compiler reports the broken project config itself.
  if (fs.existsSync(projectConfigFile)) {
    try {
      createTsgoCheckerConfig(projectConfigFile, checkerConfigFile);
    } catch {
      // A half-written tsconfig; keep the last good generated config.
    }
  }
  return projectConfigFile;
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
 * Type checking uses the canonical stable TypeScript 7.0.2 package by default,
 * supplied by the project or the builder's declared production dependency.
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
    {
      typescript: { tsgo: true, typescriptPath: tsgoPath },
    },
    ...userChain,
    (config: TsCheckerOptions) => normalizeTsgoConfig(config, rootPath),
  ];
};
