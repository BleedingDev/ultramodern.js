import fs from 'node:fs';
import path from 'node:path';
import { moduleFederationConfigFile } from '../../../ultramodern-workspace/mf-validation/constants';
import { parseObjectLiteral } from '../../../ultramodern-workspace/mf-validation/object-literal';
import { locateCreateModuleFederationConfigObject } from '../../../ultramodern-workspace/mf-validation/syntax';
import type { WorkspaceApp } from '../../../ultramodern-workspace/types';
import type { MigrationIo } from './io';

const retiredRouterDependency = 'react-router';
const reactRouterDependencies = ['react-router', 'react-router-dom'] as const;
const declaredDependencyFields = ['dependencies', 'devDependencies'] as const;

// Authored surfaces of a generated app. Build outputs and installed packages
// are excluded: only what the consumer wrote decides whether React Router is
// still a real dependency.
const authoredSourceDirectories = ['src', 'api', 'server'] as const;
const authoredSourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const skippedSourceDirectories = new Set(['dist', 'node_modules']);

// Specifier-anchored: the quote sits immediately before `react-router`, so
// '@tanstack/react-router' and 'react-router-native' never match while
// 'react-router-dom/server' does. Over-matching (a bare string literal that is
// not an import) only keeps the dependency, which is the safe direction.
const reactRouterSpecifier = /(['"`])react-router(?:-dom)?(?:\/[^'"`]*)?\1/u;

function directoryImportsReactRouter(directory: string): boolean {
  if (!fs.existsSync(directory)) {
    return false;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        !skippedSourceDirectories.has(entry.name) &&
        directoryImportsReactRouter(entryPath)
      ) {
        return true;
      }
      continue;
    }

    if (
      !entry.isFile() ||
      !authoredSourceExtensions.has(path.extname(entry.name))
    ) {
      continue;
    }

    if (reactRouterSpecifier.test(fs.readFileSync(entryPath, 'utf-8'))) {
      return true;
    }
  }

  return false;
}

export function authoredSourceImportsReactRouter(packageDirectory: string) {
  return authoredSourceDirectories.some(directory =>
    directoryImportsReactRouter(path.join(packageDirectory, directory)),
  );
}

function declaredDependencyFieldsWith(
  packageJson: Record<string, any>,
  dependency: string,
) {
  return declaredDependencyFields.filter(field => {
    const record = packageJson[field];
    return (
      typeof record === 'object' &&
      record !== null &&
      !Array.isArray(record) &&
      Object.hasOwn(record, dependency)
    );
  });
}

function readPackageJson(packageDirectory: string) {
  const packageFile = path.join(packageDirectory, 'package.json');
  if (!fs.existsSync(packageFile)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(packageFile, 'utf-8')) as Record<
      string,
      any
    >;
  } catch {
    return undefined;
  }
}

/**
 * The single definition of "this app is a React Router consumer", shared by the
 * generators, the migration and (mirrored) the generated workspace validator.
 * `@module-federation/rspack` never inspects react-router when it decides
 * whether to install the bridge router plugin — the app's own manifest is the
 * only place that opting in can be declared, so it is the only place that is
 * read. Accepts a package directory or an already parsed manifest.
 */
export function appDeclaresReactRouter(
  packageJsonOrDirectory: Record<string, any> | string,
): boolean {
  const packageJson =
    typeof packageJsonOrDirectory === 'string'
      ? readPackageJson(packageJsonOrDirectory)
      : packageJsonOrDirectory;
  if (!packageJson) {
    return false;
  }

  return reactRouterDependencies.some(
    dependency =>
      declaredDependencyFieldsWith(packageJson, dependency).length > 0,
  );
}

export type RetiredReactRouterOutcome = 'absent' | 'preserved' | 'removed';

/**
 * `react-router` was pinned into generated apps only to satisfy
 * `@module-federation/bridge-react`, whose main entry statically imports
 * `react-router-dom`. Generated Module Federation configs now opt out with
 * `bridge.enableBridgeRouter: false`, which aliases bridge-react to its
 * router-free base entry, so the pin is obsolete. Apps that genuinely import
 * React Router themselves keep it — and keeping it is exactly what re-enables
 * the bridge router for them, see `appDeclaresReactRouter`.
 *
 * Unlike `updateGeneratedToolingDependencies`, which only re-pins keys that are
 * already declared, this removes a declared key — so it must never guess: an
 * app with authored React Router imports is reported and left alone.
 */
export function removeRetiredReactRouterDependency(
  packageJson: Record<string, any>,
  packageDirectory: string,
): RetiredReactRouterOutcome {
  // A stale pin can sit in either field: the generator declared it as a runtime
  // dependency, but a consumer may have moved it while it was still required.
  const fields = declaredDependencyFieldsWith(
    packageJson,
    retiredRouterDependency,
  );
  if (fields.length === 0) {
    return 'absent';
  }

  if (authoredSourceImportsReactRouter(packageDirectory)) {
    return 'preserved';
  }

  for (const field of fields) {
    delete packageJson[field][retiredRouterDependency];
  }
  return 'removed';
}

export function isGeneratedModuleFederationConfig(source: string) {
  if (/^\s*\/\/ ultramodern-mf:/u.test(source)) {
    return true;
  }

  // Exposing remotes predate the ownership marker. These signatures appear
  // together only in the generator's canonical Module Federation template;
  // requiring the complete cohort avoids treating an ordinary authored config
  // as generated merely because it uses createModuleFederationConfig.
  return [
    "import { createRequire } from 'node:module';",
    'const pluginI18nVersion =',
    'const pluginTanstackVersion =',
    'const runtimeVersion =',
    'const reactVersion =',
    'const reactDomVersion =',
    'const moduleFederationConfig: Parameters<',
    'typeof createModuleFederationConfig',
    'export default moduleFederationConfig;',
  ].every(signature => source.includes(signature));
}

export function preflightModuleFederationBridgeRouter(
  workspaceRoot: string,
  apps: readonly Pick<WorkspaceApp, 'directory' | 'surfaceProfile'>[],
) {
  for (const app of apps) {
    if (app.surfaceProfile === 'api-only') {
      continue;
    }
    const relativeConfigPath = `${app.directory}/${moduleFederationConfigFile}`;
    const configPath = path.join(workspaceRoot, relativeConfigPath);
    if (!fs.existsSync(configPath)) {
      continue;
    }
    const source = fs.readFileSync(configPath, 'utf-8');
    const packageDirectory = path.join(workspaceRoot, app.directory);
    const packageJson = readPackageJson(packageDirectory) ?? {};
    removeRetiredReactRouterDependency(packageJson, packageDirectory);
    const nextSource = insertBridgeRouterOptOut(
      source,
      appDeclaresReactRouter(packageJson),
    );
    if (nextSource === undefined) {
      throw new Error(
        `Cannot safely migrate ${relativeConfigPath}: its ` +
          'createModuleFederationConfig value is not a static object literal. ' +
          'Resolve bridge.enableBridgeRouter explicitly before retrying; no files were written.',
      );
    }
    if (isGeneratedModuleFederationConfig(source)) {
      continue;
    }
  }
}

function createBridgeRouterEntry(enableBridgeRouter: boolean) {
  return `
  bridge: {
    enableBridgeRouter: ${enableBridgeRouter},
  },`;
}

/**
 * Returns the rewritten source, the unchanged source when a `bridge` block is
 * already declared (a hand-written one is consumer-owned), or `undefined` when
 * the config shape is not statically recognizable — in which case the caller
 * must leave the file alone.
 */
export function insertBridgeRouterOptOut(
  source: string,
  enableBridgeRouter = false,
): string | undefined {
  let configObject: ReturnType<typeof locateCreateModuleFederationConfigObject>;
  try {
    configObject = locateCreateModuleFederationConfigObject(source);
  } catch {
    return undefined;
  }

  if (configObject === undefined) {
    return undefined;
  }

  const properties = parseObjectLiteral(configObject.source);
  // A spread (or any entry this parser cannot read as a literal key) could
  // already carry `bridge`, so inserting one would be a guess.
  if (!properties || properties.hasSpread) {
    return undefined;
  }

  if (properties.properties.has('bridge')) {
    return source;
  }

  const bridgeEntry = createBridgeRouterEntry(enableBridgeRouter);
  const inner = configObject.source.slice(1, -1);
  const nextObject =
    inner.trim() === '' ? `{${bridgeEntry}\n}` : `{${bridgeEntry}${inner}}`;

  return (
    source.slice(0, configObject.start) +
    nextObject +
    source.slice(configObject.end)
  );
}

export function ensureGeneratedModuleFederationBridgeRouterOptOut(
  io: MigrationIo,
  apps: readonly Pick<WorkspaceApp, 'directory' | 'surfaceProfile'>[],
) {
  let changed = false;

  for (const app of apps) {
    if (app.surfaceProfile === 'api-only') {
      continue;
    }
    const relativeConfigPath = `${app.directory}/${moduleFederationConfigFile}`;
    const configPath = path.join(io.workspaceRoot, relativeConfigPath);
    if (!fs.existsSync(configPath)) {
      continue;
    }

    const nextSource = insertBridgeRouterOptOut(
      fs.readFileSync(configPath, 'utf-8'),
      appDeclaresReactRouter(path.join(io.workspaceRoot, app.directory)),
    );
    if (nextSource === undefined) {
      io.log(
        `${relativeConfigPath} was left unchanged: its Module Federation config ` +
          'is not a static createModuleFederationConfig object literal, so ' +
          'bridge.enableBridgeRouter must be set by hand.',
      );
      continue;
    }

    changed = io.write(configPath, nextSource) || changed;
  }

  return changed;
}
