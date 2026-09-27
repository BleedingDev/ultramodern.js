import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as t from '@babel/types';
import { type Exports, exports as resolvePackageExport } from 'resolve.exports';
import {
  parseSource,
  SourceSyntaxError,
  traverseSource,
} from './source-analysis.ts';

/** A parsed consumer module and the package directory it may traverse privately. */
export interface SourceModule {
  readonly file: t.File;
  /** Real absolute path. */
  readonly path: string;
  /** Real package directory; relative imports may not leave it. */
  readonly boundary: string;
}

/** One `name` looked up in the module at `path`, in traversal order. */
export interface ModuleGraphHop {
  readonly path: string;
  readonly name: string;
}

/**
 * Where a binding ends up. `declaration` is a workspace `const` initializer;
 * `external` is a named import or re-export from a package outside the
 * workspace source graph. `chain` starts at the requesting module and ends at
 * the declaring module (or the last workspace module before the package).
 */
export type ResolvedBinding =
  | {
      readonly kind: 'declaration';
      readonly expression: t.Expression;
      readonly module: SourceModule;
      readonly chain: readonly ModuleGraphHop[];
    }
  | {
      readonly kind: 'external';
      readonly specifier: string;
      readonly name: string;
      readonly chain: readonly ModuleGraphHop[];
    };

export interface ModuleGraph {
  readonly root: SourceModule;
  /**
   * Follow a local binding (`scope: 'local'`) or an export (`'export'`) of
   * `module` through relative imports, re-exports and public workspace
   * package exports. Unresolvable, cyclic or over-budget bindings return
   * undefined so callers fail closed.
   */
  resolve(
    module: SourceModule,
    name: string,
    scope: 'export' | 'local',
  ): ResolvedBinding | undefined;
}

const MAX_MODULES = 256;
const MAX_LOOKUPS = 512;

/** Resolution follows `const` bindings, so a module that mutates them is unreadable. */
export function parseConsumer(filePath: string): t.File {
  if (fs.statSync(filePath).size > 1_000_000)
    throw new Error(
      `${filePath}: consumer source exceeds 1 MB analysis budget`,
    );
  const file = parseSource(fs.readFileSync(filePath, 'utf8'), filePath);
  traverseSource(file, {
    AssignmentExpression(p) {
      throw new SourceSyntaxError(
        `contract bindings must be immutable at ${p.node.start}`,
      );
    },
    UpdateExpression(p) {
      throw new SourceSyntaxError(
        `contract bindings must be immutable at ${p.node.start}`,
      );
    },
    TSModuleDeclaration() {
      throw new SourceSyntaxError(
        'contract bindings must not be merged with namespaces',
      );
    },
  });
  return file;
}

export const propertyName = (node: t.Node | undefined): string | undefined => {
  if (
    node !== undefined &&
    (t.isIdentifier(node) ||
      t.isStringLiteral(node) ||
      t.isNumericLiteral(node))
  ) {
    return t.isIdentifier(node) ? node.name : String(node.value);
  }
  return undefined;
};

export const localConst = (
  sourceFile: t.File,
  name: string,
): t.VariableDeclarator | undefined => {
  for (const item of sourceFile.program.body) {
    const statement = t.isExportNamedDeclaration(item)
      ? item.declaration
      : item;
    if (!t.isVariableDeclaration(statement) || statement.kind !== 'const')
      continue;
    const matches = statement.declarations.filter(declaration =>
      t.isIdentifier(declaration.id, { name }),
    );
    if (matches.length === 1) return matches[0];
  }
  return undefined;
};

export const exportedConst = (
  sourceFile: t.File,
  name: string,
): t.VariableDeclarator | undefined => {
  for (const statement of sourceFile.program.body) {
    if (
      !t.isExportNamedDeclaration(statement) ||
      statement.exportKind === 'type'
    )
      continue;
    if (
      t.isVariableDeclaration(statement.declaration) &&
      statement.declaration.kind === 'const'
    ) {
      const declaration = statement.declaration.declarations.find(value =>
        t.isIdentifier(value.id, { name }),
      );
      if (declaration) return declaration;
    }
    if (
      !statement.source &&
      statement.specifiers.some(
        value =>
          t.isExportSpecifier(value) &&
          value.exportKind !== 'type' &&
          t.isIdentifier(value.local, { name }) &&
          t.isIdentifier(value.exported, { name }),
      )
    )
      return localConst(sourceFile, name);
  }
  return undefined;
};

const inside = (file: string, boundary: string): boolean =>
  file === boundary || file.startsWith(`${boundary}${path.sep}`);

const containingWorkspace = (file: string): string | undefined => {
  for (
    let directory = path.dirname(file);
    ;
    directory = path.dirname(directory)
  ) {
    if (fs.existsSync(path.join(directory, 'pnpm-workspace.yaml')))
      return fs.realpathSync(directory);
    if (directory === path.dirname(directory)) return undefined;
  }
};

const sourceBoundary = (file: string, workspace?: string): string => {
  for (
    let directory = path.dirname(file);
    ;
    directory = path.dirname(directory)
  ) {
    if (
      fs.existsSync(path.join(directory, 'package.json')) &&
      directory !== workspace
    )
      return fs.realpathSync(directory);
    if (directory === workspace || directory === path.dirname(directory))
      return fs.realpathSync(path.dirname(file));
  }
};

/** Resolve TypeScript source substitutions without interpreting tsconfig paths as public exports. */
const sourceFileAt = (target: string, boundary: string): string | undefined => {
  const stem = target.replace(/\.(?:[cm]?[jt]sx?)$/u, '');
  for (const candidate of [
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.mts`,
    `${stem}.cts`,
    target,
    path.join(target, 'index.ts'),
    path.join(target, 'index.tsx'),
  ]) {
    try {
      const real = fs.realpathSync(candidate);
      if (inside(real, boundary) && fs.statSync(real).isFile()) return real;
    } catch {
      // A missing candidate cannot establish a public contract binding.
    }
  }
  return undefined;
};

const packageEntry = (
  specifier: string,
): { name: string; exportKey: string } | undefined => {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#')
  )
    return undefined;
  const parts = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  if (parts.length < count || parts.slice(0, count).some(part => !part))
    return undefined;
  return {
    name: parts.slice(0, count).join('/'),
    exportKey:
      parts.length === count ? '.' : `./${parts.slice(count).join('/')}`,
  };
};

type ModuleTarget =
  | {
      readonly kind: 'module';
      readonly path: string;
      readonly boundary: string;
    }
  | { readonly kind: 'external' };

/** Public package exports are the only cross-package source traversal edge. */
const resolveModulePath = (
  module: SourceModule,
  specifier: string,
  workspace?: string,
): ModuleTarget | undefined => {
  if (/^\.\.?\//u.test(specifier)) {
    const file = sourceFileAt(
      path.resolve(path.dirname(module.path), specifier),
      module.boundary,
    );
    return file === undefined
      ? undefined
      : { kind: 'module', path: file, boundary: module.boundary };
  }
  const entry = packageEntry(specifier);
  if (!entry) return undefined;
  if (!workspace) return { kind: 'external' };
  const paths = createRequire(module.path).resolve.paths(entry.name) ?? [];
  for (const lookup of paths) {
    const directory = path.join(lookup, entry.name);
    const manifest = path.join(directory, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const boundary = fs.realpathSync(directory);
    // Installed third-party dependencies are not workspace source; their
    // bindings end the chain instead of becoming declarations.
    if (
      !inside(boundary, workspace) ||
      boundary.split(path.sep).includes('node_modules')
    )
      return { kind: 'external' };
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      name: string;
      exports?: Exports;
    };
    // A sibling's private paths are never reachable.
    if (pkg.name !== entry.name || pkg.exports === undefined) return undefined;
    let target: string | undefined;
    try {
      const targets = resolvePackageExport(pkg, entry.exportKey, {
        conditions: ['modern:source'],
      });
      target = Array.isArray(targets) ? targets[0] : undefined;
    } catch {
      return undefined;
    }
    if (!target || !target.startsWith('./')) return undefined;
    const file = sourceFileAt(path.resolve(boundary, target), boundary);
    return file === undefined
      ? undefined
      : { kind: 'module', path: file, boundary };
  }
  return { kind: 'external' };
};

const importedBinding = (
  module: SourceModule,
  name: string,
): { readonly imported: string; readonly specifier: string } | undefined => {
  for (const statement of module.file.program.body) {
    if (!t.isImportDeclaration(statement) || statement.importKind === 'type')
      continue;
    for (const specifier of statement.specifiers) {
      if (!t.isIdentifier(specifier.local, { name })) continue;
      if (t.isImportSpecifier(specifier) && specifier.importKind !== 'type')
        return {
          imported: propertyName(specifier.imported) ?? name,
          specifier: statement.source.value,
        };
      if (t.isImportDefaultSpecifier(specifier))
        return { imported: 'default', specifier: statement.source.value };
    }
  }
  return undefined;
};

const reexportedBinding = (
  module: SourceModule,
  name: string,
): { readonly local: string; readonly specifier?: string } | undefined => {
  for (const statement of module.file.program.body) {
    if (
      !t.isExportNamedDeclaration(statement) ||
      statement.exportKind === 'type'
    )
      continue;
    const specifier = statement.specifiers.find(
      value =>
        t.isExportSpecifier(value) &&
        value.exportKind !== 'type' &&
        propertyName(value.exported) === name,
    );
    if (specifier !== undefined && t.isExportSpecifier(specifier))
      return {
        local: t.isIdentifier(specifier.local)
          ? specifier.local.name
          : specifier.local.value,
        ...(statement.source ? { specifier: statement.source.value } : {}),
      };
  }
  return undefined;
};

/** A default export is either an inline expression or an alias for a local binding. */
const defaultExport = (
  module: SourceModule,
): t.Expression | string | undefined => {
  for (const statement of module.file.program.body) {
    if (!t.isExportDefaultDeclaration(statement)) continue;
    const declaration = statement.declaration;
    if (t.isIdentifier(declaration)) return declaration.name;
    return t.isExpression(declaration) ? declaration : undefined;
  }
  return undefined;
};

/**
 * The module graph rooted at `filePath`. Each module is parsed once per graph;
 * an unreadable module stays unresolved instead of assumed valid. Throws
 * `SourceSyntaxError` when the root itself is not a readable consumer module.
 */
export function createModuleGraph(filePath: string): ModuleGraph {
  const realPath = fs.realpathSync(filePath);
  const workspace = containingWorkspace(realPath);
  const root: SourceModule = {
    file: parseConsumer(realPath),
    path: realPath,
    boundary: sourceBoundary(realPath, workspace),
  };
  const modules = new Map<string, SourceModule | undefined>([
    [root.path, root],
  ]);
  const readModule = (
    modulePath: string,
    boundary: string,
  ): SourceModule | undefined => {
    if (modules.has(modulePath)) return modules.get(modulePath);
    if (modules.size >= MAX_MODULES) return undefined;
    let module: SourceModule | undefined;
    try {
      module = { file: parseConsumer(modulePath), path: modulePath, boundary };
    } catch {
      module = undefined;
    }
    modules.set(modulePath, module);
    return module;
  };

  const resolveBinding = (
    module: SourceModule,
    name: string,
    scope: 'export' | 'local',
    chain: readonly ModuleGraphHop[],
    seen: Set<string>,
  ): ResolvedBinding | undefined => {
    const key = `${scope}:${module.path}#${name}`;
    if (seen.has(key) || seen.size >= MAX_LOOKUPS) return undefined;
    seen.add(key);
    const last = chain.at(-1);
    const hops =
      last?.path === module.path && last.name === name
        ? chain
        : [...chain, { path: module.path, name }];
    const declaration =
      scope === 'export'
        ? exportedConst(module.file, name)
        : localConst(module.file, name);
    if (declaration?.init)
      return {
        kind: 'declaration',
        expression: declaration.init,
        module,
        chain: hops,
      };
    const throughModule = (
      specifier: string,
      imported: string,
      allowExternal: boolean,
    ): ResolvedBinding | undefined => {
      const target = resolveModulePath(module, specifier, workspace);
      if (target?.kind === 'external')
        return allowExternal
          ? { kind: 'external', specifier, name: imported, chain: hops }
          : undefined;
      const next = target && readModule(target.path, target.boundary);
      return next === undefined
        ? undefined
        : resolveBinding(next, imported, 'export', hops, seen);
    };
    if (scope === 'local') {
      const imported = importedBinding(module, name);
      return imported === undefined
        ? undefined
        : throughModule(imported.specifier, imported.imported, true);
    }
    if (name === 'default') {
      const exported = defaultExport(module);
      if (typeof exported === 'string')
        return resolveBinding(module, exported, 'local', hops, seen);
      return exported === undefined
        ? undefined
        : { kind: 'declaration', expression: exported, module, chain: hops };
    }
    const reexported = reexportedBinding(module, name);
    if (reexported !== undefined)
      return reexported.specifier === undefined
        ? resolveBinding(module, reexported.local, 'local', hops, seen)
        : throughModule(reexported.specifier, reexported.local, true);
    // `export *` from a package cannot prove the package exports `name`.
    for (const statement of module.file.program.body) {
      if (
        !t.isExportAllDeclaration(statement) ||
        statement.exportKind === 'type'
      )
        continue;
      const resolved = throughModule(statement.source.value, name, false);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  };

  return {
    root,
    resolve: (module, name, scope) =>
      resolveBinding(module, name, scope, [], new Set()),
  };
}
