import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import {
  createRequire,
  findPackageJSON,
  isBuiltin,
  type ResolveHookContext,
  type ResolveHookSync,
  registerHooks,
} from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface ConfigDependencyResolutionOptions {
  sourceRoots: readonly string[];
  dependencyRoots: readonly string[];
}

interface PackageRoot {
  directory: string;
  lexicalDirectory: string;
  anchorURL: string;
  require: NodeJS.Require;
  name?: string;
  hasExports: boolean;
  cohort: ReadonlySet<string>;
}

interface ResolutionSession {
  sourceRoots: readonly string[];
  dependencyRoots: readonly PackageRoot[];
  installedDependencyRoots: Set<string>;
  installedDependencyFiles: Set<string>;
  active: boolean;
  resolvingDependency: boolean;
}

const sessions = new AsyncLocalStorage<ResolutionSession>();

function hasCode(error: unknown, ...codes: readonly string[]): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  );
}

function packageName(specifier: string): string | undefined {
  if (
    isBuiltin(specifier) ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.includes(':') ||
    specifier.includes('\\')
  ) {
    return undefined;
  }
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    return segments[0].length > 1 && segments[1]
      ? `${segments[0]}/${segments[1]}`
      : undefined;
  }
  return segments[0] || undefined;
}

function canonicalDirectory(
  directory: string,
  kind: 'source' | 'dependency',
): string {
  if (!path.isAbsolute(directory)) {
    throw new Error(`Config ${kind} root must be absolute: ${directory}`);
  }
  const canonical = fs.realpathSync(directory);
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error(`Config ${kind} root must be a directory: ${directory}`);
  }
  return canonical;
}

function readRoot(directory: string): PackageRoot {
  const canonical = canonicalDirectory(directory, 'dependency');
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(canonical, 'package.json'), 'utf8'),
  );
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Invalid config dependency package manifest: ${canonical}`);
  }
  const metadata = manifest as Record<string, unknown>;
  const cohort = new Set<string>();
  if (metadata.name !== undefined) {
    if (
      typeof metadata.name !== 'string' ||
      packageName(metadata.name) !== metadata.name
    ) {
      throw new Error(`Invalid config dependency package name: ${canonical}`);
    }
    cohort.add(metadata.name);
  }
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    const dependencies = metadata[field];
    if (dependencies === undefined) continue;
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      throw new Error(
        `Invalid ${field} in config dependency root: ${canonical}`,
      );
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (packageName(name) !== name || typeof version !== 'string') {
        throw new Error(
          `Invalid ${field} in config dependency root: ${canonical}`,
        );
      }
      cohort.add(name);
    }
  }
  const anchorURL = pathToFileURL(path.join(canonical, 'package.json')).href;
  return {
    directory: canonical,
    lexicalDirectory: path.normalize(directory),
    anchorURL,
    require: createRequire(anchorURL),
    name: typeof metadata.name === 'string' ? metadata.name : undefined,
    hasExports: Object.hasOwn(metadata, 'exports'),
    cohort,
  };
}

function within(directory: string, filename: string): boolean {
  const relative = path.relative(directory, filename);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function authoredParent(
  session: ResolutionSession,
  parentURL: string | undefined,
): boolean {
  if (!parentURL?.startsWith('file:')) return false;
  try {
    const lexical = fileURLToPath(parentURL);
    const canonical = fs.realpathSync(lexical);
    if (
      lexical.split(path.sep).includes('node_modules') ||
      canonical.split(path.sep).includes('node_modules') ||
      dependencyParent(session, lexical, canonical)
    ) {
      return false;
    }
    return session.sourceRoots.some(root => within(root, canonical));
  } catch {
    return false;
  }
}

function dependencyParent(
  session: ResolutionSession,
  lexical: string,
  canonical: string,
): boolean {
  return (
    session.installedDependencyFiles.has(lexical) ||
    session.installedDependencyFiles.has(canonical) ||
    session.dependencyRoots.some(
      root =>
        within(root.directory, lexical) ||
        within(root.directory, canonical) ||
        within(root.lexicalDirectory, lexical) ||
        within(root.lexicalDirectory, canonical),
    ) ||
    [...session.installedDependencyRoots].some(
      root => within(root, lexical) || within(root, canonical),
    )
  );
}

/** Process-local provenance of actual owning installed package resolutions. */
export function isConfigInstalledDependencyPath(filename: string): boolean {
  if (filename.split(path.sep).includes('node_modules')) return true;
  const session = sessions.getStore();
  return Boolean(
    session?.active && dependencyParent(session, filename, filename),
  );
}

function markDependencyFile(
  session: ResolutionSession,
  resolvedURL: string,
): void {
  if (!resolvedURL.startsWith('file:')) return;
  const lexical = fileURLToPath(resolvedURL);
  session.installedDependencyFiles.add(lexical);
  session.installedDependencyFiles.add(fs.realpathSync(lexical));
}

function packageManifestDirectory(
  specifier: string,
  parentURL: string,
): string | undefined {
  const filename = findPackageJSON(specifier, parentURL);
  if (!filename || path.basename(filename) !== 'package.json') return undefined;
  return fs.realpathSync(path.dirname(filename));
}

function importedPackageTargets(
  specifier: string,
  parentURL: string,
): string[] {
  const scope = findPackageJSON(parentURL, parentURL);
  if (!scope || path.basename(scope) !== 'package.json') return [];
  const metadata = JSON.parse(fs.readFileSync(scope, 'utf8'));
  const imports = metadata.imports;
  if (!imports || typeof imports !== 'object') return [];
  let selected = imports[specifier];
  let capture: string | undefined;
  if (selected === undefined) {
    const patterns = Object.keys(imports)
      .filter(key => key.includes('*'))
      .sort(
        (left, right) =>
          right.indexOf('*') - left.indexOf('*') || right.length - left.length,
      );
    for (const pattern of patterns) {
      const [prefix, suffix] = pattern.split('*');
      if (
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        specifier.length >= prefix.length + suffix.length
      ) {
        selected = imports[pattern];
        capture = specifier.slice(
          prefix.length,
          specifier.length - suffix.length,
        );
        break;
      }
    }
  }
  const targets: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      const target =
        capture === undefined ? value : value.replaceAll('*', capture);
      if (packageName(target)) targets.push(target);
    } else if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) collect(nested);
    }
  };
  collect(selected);
  return targets;
}

// Retain installed ownership when Node canonicalizes linked package entries,
// and propagate it to relative descendants outside the package directory.
function recordInstalledDependency(
  session: ResolutionSession,
  specifier: string,
  parentURL: string | undefined,
  resolvedURL: string,
  context: ResolveHookContext,
  nextResolve: Parameters<ResolveHookSync>[2],
): void {
  if (!parentURL?.startsWith('file:') || !resolvedURL.startsWith('file:')) {
    return;
  }
  try {
    const lexicalParent = fileURLToPath(parentURL);
    const canonicalParent = fs.realpathSync(lexicalParent);
    const installedParent = dependencyParent(
      session,
      lexicalParent,
      canonicalParent,
    );
    // Each successful bare edge owns its selected package root, including
    // transitive resolutions from an already established installed parent.
    const name = packageName(specifier);
    if (name) {
      const installedRoot = packageManifestDirectory(name, parentURL);
      const parentRoot = packageManifestDirectory(parentURL, parentURL);
      if (
        installedRoot &&
        installedRoot !== parentRoot &&
        !within(installedRoot, canonicalParent)
      ) {
        session.installedDependencyRoots.add(installedRoot);
        markDependencyFile(session, resolvedURL);
      } else if (installedParent) {
        // A self-reference reached through an escaped relative helper retains
        // its file grant without promoting that helper's source directory.
        markDependencyFile(session, resolvedURL);
      }
      return;
    }
    // Relative/file descendants can escape a package directory. Their exact
    // file provenance must not grant ownership of other authored siblings.
    if (installedParent) {
      markDependencyFile(session, resolvedURL);
      return;
    }
    const lexicalTarget = specifier.startsWith('file:')
      ? fileURLToPath(specifier)
      : specifier.startsWith('.') || path.isAbsolute(specifier)
        ? path.resolve(path.dirname(lexicalParent), specifier)
        : undefined;
    if (lexicalTarget?.split(path.sep).includes('node_modules')) {
      markDependencyFile(session, resolvedURL);
      return;
    }
    if (specifier.startsWith('#')) {
      const previous = session.resolvingDependency;
      session.resolvingDependency = true;
      try {
        for (const target of importedPackageTargets(specifier, parentURL)) {
          try {
            const candidate = nextResolve(target, context);
            if (
              fs.realpathSync(fileURLToPath(candidate.url)) ===
              fs.realpathSync(fileURLToPath(resolvedURL))
            ) {
              const root = packageManifestDirectory(
                packageName(target)!,
                parentURL,
              );
              if (root) session.installedDependencyRoots.add(root);
              markDependencyFile(session, resolvedURL);
              return;
            }
          } catch {
            // Other conditional targets did not produce this native result.
          }
        }
      } finally {
        session.resolvingDependency = previous;
      }
    }
  } catch {
    // Resolution observation must not change a successful native load.
  }
}

// Package presence is separate from entry resolution. A broken main, export,
// manifest, or symlink must never turn into a dependency fallback.
function packagePresent(parentURL: string, name: string): boolean {
  for (const directory of createRequire(parentURL).resolve.paths(name) ?? []) {
    try {
      fs.lstatSync(path.join(directory, name));
      return true;
    } catch (error) {
      if (!hasCode(error, 'ENOENT', 'ENOTDIR')) throw error;
    }
  }
  let directory = path.dirname(fileURLToPath(parentURL));
  for (;;) {
    try {
      const metadata: unknown = JSON.parse(
        fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
      );
      if (
        metadata &&
        typeof metadata === 'object' &&
        'name' in metadata &&
        metadata.name === name
      ) {
        return true;
      }
    } catch (error) {
      if (!hasCode(error, 'ENOENT', 'ENOTDIR')) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

function isImport(context: ResolveHookContext): boolean {
  return (
    context.conditions.includes('import') &&
    !context.conditions.includes('require')
  );
}

/**
 * Evaluate original config sources with their dependencies preferred.
 * The owning child process also isolates native module caches, which survive
 * hook deregistration.
 */
export async function withConfigDependencyResolution<T>(
  options: ConfigDependencyResolutionOptions,
  evaluate: () => Promise<T>,
): Promise<T> {
  const session: ResolutionSession = {
    sourceRoots: options.sourceRoots.map(root =>
      canonicalDirectory(root, 'source'),
    ),
    dependencyRoots: options.dependencyRoots.map(readRoot),
    installedDependencyRoots: new Set<string>(),
    installedDependencyFiles: new Set<string>(),
    active: true,
    resolvingDependency: false,
  };
  // Cohort modules can already be cached by the owning CJS worker before its
  // config hook starts. This is runtime eligibility, not a source inventory.
  for (const root of session.dependencyRoots) {
    for (const name of root.cohort) {
      try {
        const installed = packageManifestDirectory(name, root.anchorURL);
        if (installed) session.installedDependencyRoots.add(installed);
      } catch {}
      try {
        const filename = root.require.resolve(
          name === root.name && !root.hasExports ? root.directory : name,
        );
        markDependencyFile(session, pathToFileURL(filename).href);
        const cached = root.require.cache[filename];
        const pending = cached ? [cached] : [];
        const visited = new Set<NodeJS.Module>();
        while (pending.length) {
          const module = pending.pop()!;
          if (visited.has(module)) continue;
          visited.add(module);
          if (module.filename)
            markDependencyFile(session, pathToFileURL(module.filename).href);
          pending.push(...module.children);
        }
      } catch {}
    }
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        const result = nextResolve(specifier, context);
        const current = sessions.getStore();
        if (current?.active) {
          recordInstalledDependency(
            current,
            specifier,
            context.parentURL,
            result.url,
            context,
            nextResolve,
          );
        }
        return result;
      } catch (originalError) {
        const current = sessions.getStore();
        const name = packageName(specifier);
        if (
          !current?.active ||
          current.resolvingDependency ||
          !name ||
          !hasCode(originalError, 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND') ||
          !authoredParent(current, context.parentURL)
        ) {
          throw originalError;
        }
        try {
          if (packagePresent(context.parentURL!, name)) throw originalError;
        } catch {
          throw originalError;
        }
        for (const root of current.dependencyRoots) {
          if (!root.cohort.has(name)) continue;
          current.resolvingDependency = true;
          try {
            // Packages without exports have no Node self-reference. Resolve
            // their own main/index using Node's public directory resolver.
            if (name === root.name && !root.hasExports) {
              const suffix = specifier.slice(name.length + 1);
              const target = suffix
                ? path.resolve(root.directory, suffix)
                : root.directory;
              if (
                target !== root.directory &&
                !within(root.directory, target)
              ) {
                throw originalError;
              }
              const filename =
                isImport(context) && suffix
                  ? target
                  : root.require.resolve(target);
              const url = pathToFileURL(filename).href;
              markDependencyFile(current, url);
              return isImport(context)
                ? nextResolve(url, context)
                : { url, shortCircuit: true };
            }
            if (isImport(context)) {
              const result = nextResolve(specifier, {
                ...context,
                parentURL: root.anchorURL,
              });
              recordInstalledDependency(
                current,
                specifier,
                root.anchorURL,
                result.url,
                { ...context, parentURL: root.anchorURL },
                nextResolve,
              );
              markDependencyFile(current, result.url);
              return result;
            }
            const url = pathToFileURL(root.require.resolve(specifier)).href;
            recordInstalledDependency(
              current,
              specifier,
              root.anchorURL,
              url,
              { ...context, parentURL: root.anchorURL },
              nextResolve,
            );
            markDependencyFile(current, url);
            return {
              url,
              shortCircuit: true,
            };
          } catch (error) {
            if (
              !hasCode(error, 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND') ||
              name === root.name
            ) {
              throw error;
            }
            try {
              if (packagePresent(root.anchorURL, name)) throw error;
            } catch {
              throw error;
            }
          } finally {
            current.resolvingDependency = false;
          }
        }
        throw originalError;
      }
    },
  });
  try {
    return await sessions.run(session, evaluate);
  } finally {
    session.active = false;
    hooks.deregister();
  }
}
