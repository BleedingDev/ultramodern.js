import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Binding, NodePath, Scope } from '@babel/traverse';
import * as t from '@babel/types';
import { type Exports, exports as resolvePackageExport } from 'resolve.exports';
import {
  parseSource,
  SourceSyntaxError,
  traverseSource,
  unwrapExpression,
} from './source-analysis.ts';

/** A parsed workspace module and the package directory it may traverse privately. */
export interface SourceModule {
  readonly file: t.File;
  /** Real absolute path. */
  readonly path: string;
  /** Real package directory; relative imports may not leave it. */
  readonly boundary: string;
  /**
   * Every assignment, update and namespace merge in the module. Validation
   * that reads initializers directly must reject a module that has any.
   */
  readonly mutations: readonly t.Node[];
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

/**
 * One value an expression can evaluate to.
 * - `external`: `name` imported from package `specifier`, then `members`
 *   accessed on it (`Schema.Unknown` is `effect` / `Schema` / `['Unknown']`;
 *   a namespace import of the package itself is `name: '*'`).
 * - `node`: a workspace expression, function or class the source spells out
 *   (a call to an external factory, a literal, a function).
 * - `unresolved`: a parameter, global, dynamic access or anything beyond the
 *   analysis budget. Rules that must be sound treat it as a violation.
 */
export type GraphValue =
  | {
      readonly kind: 'external';
      readonly specifier: string;
      readonly name: string;
      readonly members: readonly string[];
    }
  | {
      readonly kind: 'node' | 'unresolved';
      readonly node: t.Node;
      readonly module: SourceModule;
    };

export interface ModuleGraph {
  /**
   * The parsed workspace module at `filePath`, parsed once per graph. Throws
   * `SourceSyntaxError` when the file is not readable consumer source.
   */
  module(filePath: string): SourceModule;
  /**
   * Follow a local binding (`scope: 'local'`) or an export (`'export'`) of
   * `module` through relative imports, re-exports and public workspace
   * package exports to an unmutated `const`. Unresolvable, mutated, cyclic or
   * over-budget bindings return undefined so callers fail closed.
   */
  resolve(
    module: SourceModule,
    name: string,
    scope: 'export' | 'local',
  ): ResolvedBinding | undefined;
  /**
   * Every value `expression` (a node of `module`) can evaluate to, following
   * any binding kind, destructuring, member access into object literals,
   * member assignments (`obj.key = value`), reassignments, conditional
   * branches, and calls into workspace functions through their returns.
   */
  evaluate(module: SourceModule, expression: t.Node): readonly GraphValue[];
  /**
   * Every `external` and `unresolved` value reachable from `expression`: each
   * reference inside it is evaluated, and every workspace node it evaluates
   * to is walked in turn, across modules. `Schema.Struct({ a: shared })`
   * reaches `Schema.Struct` plus whatever `shared` is built from.
   */
  reachable(module: SourceModule, expression: t.Node): readonly GraphValue[];
}

/** Per-query work and nesting budgets; exhausting one yields `unresolved`, never a pass. */
const MAX_LOOKUPS = 4096;
const MAX_DEPTH = 192;
const MAX_ALIASES = 512;

interface MemberWrite {
  /** Static members written; for a `dynamic` write, the prefix before the computed key. */
  readonly path: readonly string[];
  /** Written through a computed key (`obj[key] = value`) that may name any member. */
  readonly dynamic: boolean;
  /** Member levels below the root binding, static or not. */
  readonly depth: number;
  /** Undefined for compound writes (`+=`, `++`) whose value is not an expression. */
  readonly value?: t.Expression;
  /** Members of `value` that were written, for a destructuring assignment. */
  readonly from?: readonly string[];
  readonly node: t.Node;
}

interface ModuleFacts {
  readonly scope: Scope;
  readonly workspace: string | undefined;
  /** Referenced identifiers and the binding each one reads; globals read none. */
  readonly references: ReadonlyMap<
    t.Identifier | t.JSXIdentifier,
    Binding | undefined
  >;
  /** Return arguments per function. */
  readonly returns: ReadonlyMap<t.Node, readonly t.Expression[]>;
  /** Functions with a bare `return;`. */
  readonly bareReturns: ReadonlySet<t.Node>;
  /** The scope of each function, which owns its parameters. */
  readonly functionScopes: ReadonlyMap<t.Node, Scope>;
  /** `binding.a.b = value` writes per root binding. */
  readonly writes: ReadonlyMap<Binding, readonly MemberWrite[]>;
  /** Names merged with a TypeScript namespace; they have no single value. */
  readonly merged: ReadonlySet<string>;
  /** `exports.a = v`, `module.exports.a = v` and `module.exports = v` writes. */
  readonly commonJs: readonly MemberWrite[];
}

/** The static name a member access or object key uses; undefined when dynamic. */
const staticKey = (
  node:
    | t.MemberExpression
    | t.OptionalMemberExpression
    | t.ObjectMember
    | t.ObjectProperty,
): string | undefined => {
  const key = 'property' in node ? node.property : node.key;
  return !node.computed || t.isStringLiteral(key) || t.isNumericLiteral(key)
    ? propertyName(key)
    : undefined;
};

/**
 * The member write target `a.b['c']` as `a` plus `['b', 'c']`. A computed key
 * makes it `dynamic`, with `path` cut to the static prefix before that key.
 * `depth` counts every member level, static or not.
 */
const writeTarget = (
  node: t.Node,
):
  | { root: t.Identifier; path: string[]; dynamic: boolean; depth: number }
  | undefined => {
  let names: string[] = [];
  let dynamic = false;
  let depth = 0;
  let current = unwrapExpression(node, true);
  while (
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current)
  ) {
    const name = staticKey(current);
    depth += 1;
    if (name === undefined) {
      names = [];
      dynamic = true;
    } else names.unshift(name);
    current = unwrapExpression(current.object, true);
  }
  return t.isIdentifier(current)
    ? { root: current, path: names, dynamic, depth }
    : undefined;
};

/**
 * The owner of member writes whose receiver is computed (`get().key = v`).
 * Which object they reach is not modeled, so every binding read in a module
 * with such a write is also unresolved.
 */
const OPAQUE_RECEIVER = {} as Binding;

/** `get().key` or `(a || b).key`: a member write on a computed receiver. */
const opaqueReceiver = (target: t.Node): boolean => {
  let current = unwrapExpression(target, true);
  if (!t.isMemberExpression(current) && !t.isOptionalMemberExpression(current))
    return false;
  while (t.isMemberExpression(current) || t.isOptionalMemberExpression(current))
    current = unwrapExpression(current.object, true);
  return !(
    t.isIdentifier(current) ||
    t.isThisExpression(current) ||
    t.isSuper(current)
  );
};

/** Array, Map and Set methods that can return a stored element. */
const CONTAINER_EXTRACTORS = new Set([
  'at',
  'concat',
  'entries',
  'filter',
  'find',
  'findLast',
  'flat',
  'flatMap',
  'get',
  'map',
  'pop',
  'reduce',
  'reduceRight',
  'shift',
  'slice',
  'splice',
  'toReversed',
  'toSorted',
  'toSpliced',
  'values',
  'with',
]);

/** Member expressions a destructuring assignment pattern writes. */
/**
 * Member expressions a destructuring assignment pattern writes, each with
 * the members of the assigned value it receives. `from` is undefined when
 * that part is dynamic, a rest, or may come from a default.
 */
const patternMembers = (
  pattern: t.Node,
  from: readonly string[] | undefined = [],
): { target: t.Node; from?: readonly string[] }[] =>
  t.isMemberExpression(pattern) || t.isOptionalMemberExpression(pattern)
    ? [{ target: pattern, from }]
    : t.isObjectPattern(pattern)
      ? pattern.properties.flatMap(property => {
          if (t.isRestElement(property))
            return patternMembers(property.argument, undefined);
          const key = staticKey(property);
          return patternMembers(
            property.value,
            from && key !== undefined ? [...from, key] : undefined,
          );
        })
      : t.isArrayPattern(pattern)
        ? pattern.elements.flatMap((element, index) =>
            element
              ? patternMembers(
                  element,
                  from && !t.isRestElement(element)
                    ? [...from, String(index)]
                    : undefined,
                )
              : [],
          )
        : t.isRestElement(pattern)
          ? patternMembers(pattern.argument, undefined)
          : t.isAssignmentPattern(pattern)
            ? patternMembers(pattern.left, undefined)
            : [];

/**
 * Parse a workspace module and index what evaluation follows. Assigning a
 * `const` or an import is a binding error; any other mutation is recorded so
 * evaluation follows it and `resolve` fails closed on it.
 */
function parseModule(filePath: string, workspace: string | undefined) {
  if (fs.statSync(filePath).size > 1_000_000)
    throw new Error(
      `${filePath}: consumer source exceeds 1 MB analysis budget`,
    );
  const file = parseSource(fs.readFileSync(filePath, 'utf8'), filePath);
  let scope: Scope | undefined;
  const references = new Map<
    t.Identifier | t.JSXIdentifier,
    Binding | undefined
  >();
  const returns = new Map<t.Node, t.Expression[]>();
  const bareReturns = new Set<t.Node>();
  const functionScopes = new Map<t.Node, Scope>();
  const writes = new Map<Binding, MemberWrite[]>();
  const merged = new Set<string>();
  const mutations: t.Node[] = [];
  const commonJs: MemberWrite[] = [];
  /**
   * Where a top-level `module.exports = value` detaches the `exports` object;
   * later writes through `exports` no longer reach the module's exports.
   */
  let exportsDetachedAt: number | undefined;
  const assertAssignable = (binding: Binding | undefined, at: t.Node) => {
    if (binding?.kind === 'const' || binding?.kind === 'module')
      throw new SourceSyntaxError(
        `${binding.kind === 'module' ? 'imports' : 'const bindings'} must not be reassigned at ${at.start}`,
      );
  };
  const recordWrite = (
    scopeOf: Scope,
    target: t.Node,
    node: t.Node,
    value?: t.Expression,
    from?: readonly string[],
  ) => {
    const member = writeTarget(target);
    if (!member) {
      if (opaqueReceiver(target))
        writes.set(OPAQUE_RECEIVER, [
          ...(writes.get(OPAQUE_RECEIVER) ?? []),
          { path: [], dynamic: true, depth: 0, value, from, node },
        ]);
      return;
    }
    // `module.exports.a`, `exports.a`, or `api.a` for a chain of `const`
    // aliases (`const api = module.exports.api`) also writes an export.
    let root = member;
    let through: string[] = [];
    for (let hop = 0; hop < MAX_DEPTH; hop += 1) {
      const alias = scopeOf.getBinding(root.root.name);
      const init =
        alias?.kind === 'const' && t.isVariableDeclarator(alias.path.node)
          ? alias.path.node.init
          : undefined;
      const next = init ? writeTarget(init) : undefined;
      if (!next || next.dynamic) break;
      through = [...root.path, ...through];
      root = next;
    }
    const exported =
      root.root.name === 'module' && root.path[0] === 'exports'
        ? [...root.path.slice(1), ...through]
        : root.root.name === 'exports'
          ? [...root.path, ...through]
          : undefined;
    const detached =
      root.root.name === 'exports' &&
      exportsDetachedAt !== undefined &&
      (node.start ?? 0) >= exportsDetachedAt;
    if (exported && !detached && !scopeOf.getBinding(root.root.name))
      commonJs.push({
        path: exported,
        dynamic: member.dynamic,
        depth: member.depth,
        value,
        from,
        node,
      });
    const binding =
      member.dynamic || member.path.length > 0
        ? scopeOf.getBinding(member.root.name)
        : undefined;
    if (!binding) return;
    writes.set(binding, [
      ...(writes.get(binding) ?? []),
      {
        path: member.path,
        dynamic: member.dynamic,
        depth: member.depth,
        value,
        from,
        node,
      },
    ]);
  };
  traverseSource(file, {
    Program(p) {
      scope = p.scope;
    },
    // Includes component names in JSX (`<Card />`, `<ui.Card />`).
    ReferencedIdentifier(p) {
      references.set(p.node, p.scope.getBinding(p.node.name));
    },
    Function(p) {
      functionScopes.set(p.node, p.scope);
    },
    ReturnStatement(p) {
      const owner = p.getFunctionParent();
      if (!owner) return;
      if (p.node.argument)
        returns.set(owner.node, [
          ...(returns.get(owner.node) ?? []),
          p.node.argument,
        ]);
      else bareReturns.add(owner.node);
    },
    AssignmentExpression(p) {
      mutations.push(p.node);
      // `a ??= b` (and `&&=`, `||=`) may store `b`; arithmetic writes are opaque.
      const stored = ['=', '&&=', '||=', '??='].includes(p.node.operator)
        ? p.node.right
        : undefined;
      for (const name of Object.keys(t.getBindingIdentifiers(p.node.left)))
        assertAssignable(p.scope.getBinding(name), p.node);
      if (!t.isPattern(p.node.left))
        recordWrite(p.scope, p.node.left, p.node, stored);
      // Member targets inside a pattern receive a part of the value.
      else
        for (const { target, from } of patternMembers(p.node.left))
          recordWrite(
            p.scope,
            target,
            p.node,
            from && p.node.operator === '=' ? p.node.right : undefined,
            from,
          );
      // `exports = module.exports` reattaches `exports` to the live object.
      if (
        p.node.operator === '=' &&
        t.isIdentifier(p.node.left, { name: 'exports' }) &&
        !p.scope.getBinding('exports') &&
        t.isMemberExpression(p.node.right) &&
        t.isIdentifier(p.node.right.object, { name: 'module' }) &&
        staticKey(p.node.right) === 'exports' &&
        p.parentPath.isExpressionStatement() &&
        p.parentPath.parentPath?.isProgram()
      )
        exportsDetachedAt = undefined;
      // `module.exports = exports = value` keeps `exports` attached.
      else if (
        exportsDetachedAt === undefined &&
        p.node.operator === '=' &&
        t.isMemberExpression(p.node.left) &&
        t.isIdentifier(p.node.left.object, { name: 'module' }) &&
        staticKey(p.node.left) === 'exports' &&
        !p.scope.getBinding('module') &&
        !(
          t.isAssignmentExpression(p.node.right) &&
          t.isIdentifier(p.node.right.left, { name: 'exports' })
        ) &&
        p.parentPath.isExpressionStatement() &&
        p.parentPath.parentPath?.isProgram()
      )
        exportsDetachedAt = p.node.end ?? undefined;
    },
    // `for (target.key of items)` writes each item into a member target.
    ForXStatement(p) {
      const left = p.node.left;
      if (t.isVariableDeclaration(left)) return;
      mutations.push(p.node);
      for (const { target } of patternMembers(left))
        recordWrite(p.scope, target, p.node);
    },
    // Built-in mutators write into their first argument:
    // `Object.assign(target, { key: value })` is `target.key = value`.
    CallExpression(p) {
      const callee = unwrapExpression(p.node.callee, true);
      const owner =
        t.isMemberExpression(callee) && t.isIdentifier(callee.object)
          ? callee.object.name
          : undefined;
      const method = t.isMemberExpression(callee)
        ? staticKey(callee)
        : undefined;
      const [target, ...rest] = p.node.arguments;
      if (
        !owner ||
        !method ||
        !target ||
        !t.isExpression(target) ||
        p.scope.getBinding(owner) ||
        !(
          (owner === 'Object' &&
            [
              'assign',
              'defineProperty',
              'defineProperties',
              'setPrototypeOf',
            ].includes(method)) ||
          (owner === 'Reflect' &&
            [
              'set',
              'defineProperty',
              'deleteProperty',
              'setPrototypeOf',
            ].includes(method))
        )
      )
        return;
      mutations.push(p.node);
      const anyMember = t.memberExpression(target, t.identifier('key'), true);
      const sources = method === 'assign' ? rest : [undefined];
      for (const source of sources) {
        if (!t.isObjectExpression(source)) {
          recordWrite(p.scope, anyMember, p.node);
          continue;
        }
        for (const property of source.properties) {
          const key = t.isObjectProperty(property)
            ? staticKey(property)
            : undefined;
          if (key === undefined || !t.isObjectProperty(property))
            recordWrite(p.scope, anyMember, p.node);
          else
            recordWrite(
              p.scope,
              t.memberExpression(target, t.stringLiteral(key), true),
              p.node,
              property.value as t.Expression,
            );
        }
      }
    },
    UnaryExpression(p) {
      if (p.node.operator !== 'delete') return;
      mutations.push(p.node);
      recordWrite(p.scope, p.node.argument, p.node);
    },
    UpdateExpression(p) {
      mutations.push(p.node);
      if (t.isIdentifier(p.node.argument))
        assertAssignable(p.scope.getBinding(p.node.argument.name), p.node);
      recordWrite(p.scope, p.node.argument, p.node);
    },
    TSModuleDeclaration(p) {
      if (!t.isIdentifier(p.node.id)) return;
      merged.add(p.node.id.name);
      mutations.push(p.node);
    },
  });
  if (!scope) throw new Error(`${filePath}: program scope missing`);
  const facts: ModuleFacts = {
    scope,
    workspace,
    references,
    returns,
    bareReturns,
    functionScopes,
    writes,
    merged,
    commonJs,
  };
  return { file, facts, mutations };
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
    `${stem}.js`,
    `${stem}.jsx`,
    `${stem}.mjs`,
    `${stem}.cjs`,
    path.join(target, 'index.ts'),
    path.join(target, 'index.tsx'),
    path.join(target, 'index.mts'),
    path.join(target, 'index.cts'),
    path.join(target, 'index.js'),
    path.join(target, 'index.jsx'),
    path.join(target, 'index.mjs'),
    path.join(target, 'index.cjs'),
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
      const targets = resolvePackageExport(
        { ...pkg, exports: selectExportPattern(pkg.exports, entry.exportKey) },
        entry.exportKey,
        { conditions: ['modern:source'] },
      );
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

/** Node's PATTERN_KEY_COMPARE: negative when pattern `a` takes precedence. */
const patternKeyCompare = (a: string, b: string): number => {
  const aBase = a.indexOf('*') + 1;
  const bBase = b.indexOf('*') + 1;
  if (aBase !== bBase) return bBase - aBase;
  return b.length - a.length;
};

/**
 * `exports` narrowed to the one subpath pattern Node selects for `key`: the
 * match with the longest prefix before `*`, then the longest key.
 * `resolve.exports` takes the last matching pattern instead.
 */
const selectExportPattern = (exports: Exports, key: string): Exports => {
  if (typeof exports !== 'object' || exports === null || Array.isArray(exports))
    return exports;
  const subpaths = exports as Record<string, Exports>;
  const keys = Object.keys(subpaths);
  if (!keys.every(candidate => candidate.startsWith('.')) || key in subpaths)
    return exports;
  let best: string | undefined;
  for (const candidate of keys) {
    const star = candidate.indexOf('*');
    if (star === -1 || candidate.indexOf('*', star + 1) !== -1) continue;
    const prefix = candidate.slice(0, star);
    const suffix = candidate.slice(star + 1);
    if (
      key.startsWith(prefix) &&
      key !== prefix &&
      key.endsWith(suffix) &&
      key.length >= candidate.length &&
      (best === undefined || patternKeyCompare(candidate, best) < 0)
    )
      best = candidate;
  }
  return best === undefined ? exports : { [best]: subpaths[best] };
};

/** What a module's export `name` forwards to, one hop at a time. */
type ExportHop =
  | { readonly kind: 'local'; readonly name: string }
  | {
      readonly kind: 'reexport';
      readonly specifier: string;
      readonly name: string;
    }
  | { readonly kind: 'namespace'; readonly specifier: string }
  | { readonly kind: 'node'; readonly node: t.Node };

const exportHop = (file: t.File, name: string): ExportHop | undefined => {
  for (const statement of file.program.body) {
    if (t.isExportDefaultDeclaration(statement)) {
      if (name !== 'default') continue;
      const declaration = statement.declaration;
      if (t.isIdentifier(declaration))
        return { kind: 'local', name: declaration.name };
      if (
        (t.isFunctionDeclaration(declaration) ||
          t.isClassDeclaration(declaration)) &&
        declaration.id
      )
        return { kind: 'local', name: declaration.id.name };
      return { kind: 'node', node: declaration };
    }
    if (
      !t.isExportNamedDeclaration(statement) ||
      statement.exportKind === 'type'
    )
      continue;
    const declaration = statement.declaration;
    if (
      (t.isVariableDeclaration(declaration) ||
        t.isFunctionDeclaration(declaration) ||
        t.isClassDeclaration(declaration)) &&
      !declaration.declare &&
      name in t.getBindingIdentifiers(declaration)
    )
      return { kind: 'local', name };
    for (const specifier of statement.specifiers) {
      if (propertyName(specifier.exported) !== name) continue;
      if (t.isExportNamespaceSpecifier(specifier) && statement.source)
        return { kind: 'namespace', specifier: statement.source.value };
      if (!t.isExportSpecifier(specifier) || specifier.exportKind === 'type')
        continue;
      const local = propertyName(specifier.local) ?? name;
      return statement.source
        ? { kind: 'reexport', specifier: statement.source.value, name: local }
        : { kind: 'local', name: local };
    }
  }
  return undefined;
};

/** Names a module exports itself, without `export *`. */
const exportNames = (file: t.File): string[] =>
  file.program.body.flatMap(statement => {
    if (t.isExportDefaultDeclaration(statement)) return ['default'];
    if (
      !t.isExportNamedDeclaration(statement) ||
      statement.exportKind === 'type'
    )
      return [];
    const declared =
      statement.declaration &&
      !t.isTSTypeAliasDeclaration(statement.declaration) &&
      !t.isTSInterfaceDeclaration(statement.declaration)
        ? Object.keys(t.getBindingIdentifiers(statement.declaration))
        : [];
    return [
      ...declared,
      ...statement.specifiers.flatMap(specifier =>
        t.isExportSpecifier(specifier) && specifier.exportKind === 'type'
          ? []
          : [propertyName(specifier.exported) ?? ''],
      ),
    ].filter(Boolean);
  });

/** `export * from` sources; they cannot provide `default`. */
const starSources = (file: t.File, name: string): string[] =>
  name === 'default'
    ? []
    : file.program.body.flatMap(statement =>
        t.isExportAllDeclaration(statement) && statement.exportKind !== 'type'
          ? [statement.source.value]
          : [],
      );

/** The import a module-kind binding reads, or undefined for type-only imports. */
const importOf = (
  binding: Binding,
): { specifier: string; name: string } | undefined => {
  const specifier = binding.path.node;
  const declaration = binding.path.parent;
  if (
    !t.isImportDeclaration(declaration) ||
    declaration.importKind === 'type' ||
    declaration.importKind === 'typeof' ||
    (t.isImportSpecifier(specifier) && specifier.importKind === 'type')
  )
    return undefined;
  const name = t.isImportSpecifier(specifier)
    ? propertyName(specifier.imported)
    : t.isImportDefaultSpecifier(specifier)
      ? 'default'
      : t.isImportNamespaceSpecifier(specifier)
        ? '*'
        : undefined;
  return name === undefined
    ? undefined
    : { specifier: declaration.source.value, name };
};

type PatternPath =
  | {
      readonly members: readonly string[];
      /** Defaults that apply at `members` below the declarator's value. */
      readonly defaults: readonly {
        readonly members: readonly string[];
        readonly value: t.Expression;
      }[];
    }
  | 'dynamic';

/** Member path from a destructuring pattern's source to `target`. */
const patternPath = (
  pattern: t.Node,
  target: t.Identifier,
): PatternPath | undefined => {
  if (pattern === target) return { members: [], defaults: [] };
  if (t.isAssignmentPattern(pattern)) {
    const inner = patternPath(pattern.left, target);
    return inner === undefined || inner === 'dynamic'
      ? inner
      : {
          members: inner.members,
          defaults: [{ members: [], value: pattern.right }, ...inner.defaults],
        };
  }
  if (t.isObjectPattern(pattern))
    for (const property of pattern.properties) {
      const inner = patternPath(
        t.isRestElement(property) ? property.argument : property.value,
        target,
      );
      if (inner === undefined) continue;
      const key = t.isObjectProperty(property)
        ? staticKey(property)
        : undefined;
      if (inner === 'dynamic' || key === undefined) return 'dynamic';
      return {
        members: [key, ...inner.members],
        defaults: inner.defaults.map(entry => ({
          members: [key, ...entry.members],
          value: entry.value,
        })),
      };
    }
  // Array slots before any rest element are static indices.
  if (t.isArrayPattern(pattern))
    for (const [index, element] of pattern.elements.entries()) {
      const inner = element ? patternPath(element, target) : undefined;
      if (inner === undefined) continue;
      if (inner === 'dynamic' || t.isRestElement(element)) return 'dynamic';
      return {
        members: [String(index), ...inner.members],
        defaults: inner.defaults.map(entry => ({
          members: [String(index), ...entry.members],
          value: entry.value,
        })),
      };
    }
  if (t.isRestElement(pattern))
    return Object.values(t.getBindingIdentifiers(pattern)).includes(target)
      ? 'dynamic'
      : undefined;
  return undefined;
};

/**
 * For `const { a, ...rest } = source`, the member path from `source` to the
 * object `rest` copies, and the keys it leaves out. Undefined when `target`
 * is not an object rest reached through static keys.
 */
const objectRestPath = (
  pattern: t.Node,
  target: t.Identifier,
):
  | { members: readonly string[]; excluded: ReadonlySet<string> }
  | undefined => {
  if (!t.isObjectPattern(pattern)) return undefined;
  const excluded = new Set<string>();
  for (const property of pattern.properties) {
    if (t.isRestElement(property)) {
      if (property.argument === target) return { members: [], excluded };
      continue;
    }
    const key = staticKey(property);
    // A computed key may leave out any member.
    if (key === undefined) return undefined;
    excluded.add(key);
    const inner = objectRestPath(
      t.isAssignmentPattern(property.value)
        ? property.value.left
        : property.value,
      target,
    );
    if (inner)
      return { members: [key, ...inner.members], excluded: inner.excluded };
  }
  return undefined;
};

/**
 * `binding` plus every binding of the same module that aliases its object or
 * one of its members (`const alias = binding`, `alias = binding`,
 * `const { a } = binding`), each with the member path it aliases, so writes
 * through an alias count as writes to the original. Undefined when the
 * aliases exceed the budget, e.g. a self-referential `alias = alias.child`.
 */
/**
 * Where `fn` runs and hands back its result: calls of an immediately invoked
 * function, of a named function or `const` and its `const` aliases, and of a
 * method of a `const` or inline object literal. A getter runs on each read of
 * its member. `escaped` when the function is also used in a way whose calls
 * cannot be seen, such as a callback.
 */
const callSitesOf = (
  fn: NodePath<t.Function>,
): { calls: NodePath[]; escaped: boolean } => {
  const outer = fn.parentPath;
  if (t.isCallExpression(outer?.node) && outer.node.callee === fn.node)
    return { calls: [outer!], escaped: false };
  const member = t.isObjectMethod(fn.node)
    ? fn
    : t.isObjectProperty(outer?.node) && outer.node.value === fn.node
      ? outer
      : undefined;
  const key =
    member && t.isObjectMember(member.node)
      ? staticKey(member.node)
      : undefined;
  const getter = t.isObjectMethod(fn.node) && fn.node.kind === 'get';
  const object = key === undefined ? undefined : member!.parentPath;
  /** The expression that runs the function once `callee` is evaluated. */
  const runAt = (callee: NodePath): NodePath | undefined => {
    if (getter) return callee;
    let invoked = callee;
    // `fn.call(self, ...)` and `fn.apply(self, args)` run `fn` as well.
    const via = invoked.parentPath;
    if (
      via &&
      t.isMemberExpression(via.node) &&
      via.node.object === invoked.node &&
      ['call', 'apply'].includes(staticKey(via.node) ?? '')
    )
      invoked = via;
    const call = invoked.parentPath;
    return call &&
      t.isCallExpression(call.node) &&
      call.node.callee === invoked.node
      ? call
      : undefined;
  };
  const calls: NodePath[] = [];
  let escaped = false;
  // `({ get x() {} }).x` or `({ run() {} }).run()` on an inline literal.
  const inline = object?.parentPath;
  if (
    object &&
    (t.isMemberExpression(inline?.node) ||
      t.isOptionalMemberExpression(inline?.node)) &&
    inline.node.object === object.node
  ) {
    const run = staticKey(inline.node) === key ? runAt(inline!) : undefined;
    return run ? { calls: [run], escaped: false } : { calls, escaped: true };
  }
  const owner = object?.parentPath;
  const name = t.isFunctionDeclaration(fn.node)
    ? fn.node.id?.name
    : t.isVariableDeclarator(outer?.node) && t.isIdentifier(outer.node.id)
      ? outer.node.id.name
      : t.isVariableDeclarator(owner?.node) && t.isIdentifier(owner.node.id)
        ? owner.node.id.name
        : undefined;
  const first = name
    ? (key === undefined ? fn.scope.parent : owner!.scope)?.getBinding(name)
    : undefined;
  if (!first) return { calls, escaped: true };
  // The function, or the object holding it, and its `const` aliases.
  const bindings = [first];
  for (
    let index = 0;
    index < bindings.length && index < MAX_ALIASES;
    index += 1
  )
    for (let reference of bindings[index]!.referencePaths) {
      while (
        reference.parentPath &&
        unwrapExpression(reference.parent, true) !== reference.parent
      )
        reference = reference.parentPath;
      const parent = reference.parent;
      if (
        t.isVariableDeclarator(parent) &&
        parent.init === reference.node &&
        t.isIdentifier(parent.id)
      ) {
        const alias = reference.scope.getBinding(parent.id.name);
        if (alias && !bindings.includes(alias)) bindings.push(alias);
        continue;
      }
      const callee =
        key === undefined
          ? reference
          : (t.isMemberExpression(parent) ||
                t.isOptionalMemberExpression(parent)) &&
              parent.object === reference.node &&
              staticKey(parent) === key
            ? reference.parentPath!
            : undefined;
      const run = callee ? runAt(callee) : undefined;
      if (run) calls.push(run);
      // Taking the function as a value (a callback) hides its calls, and so
      // does the holding object escaping as a whole.
      else if (callee && (key !== undefined || !isReadOnlyUse(reference)))
        escaped = true;
      else if (!callee && !isReadOnlyUse(reference)) escaped = true;
    }
  return { calls, escaped };
};

/**
 * The property `key` of an object literal, looking through spreads of
 * `const` object literals; `unknown` when a spread cannot be read.
 */
const methodOf = (
  literal: NodePath<t.ObjectExpression>,
  key: string,
  depth = 0,
): NodePath | 'unknown' | undefined => {
  for (const entry of literal.get('properties').toReversed()) {
    if (
      (entry.isObjectMethod() || entry.isObjectProperty()) &&
      staticKey(entry.node) === key
    )
      return entry;
    if (!entry.isSpreadElement()) continue;
    const argument = unwrapExpression(entry.node.argument, true);
    const binding = t.isIdentifier(argument)
      ? entry.scope.getBinding(argument.name)
      : undefined;
    const init =
      binding?.kind === 'const' && binding.path.isVariableDeclarator()
        ? (binding.path.get('init') as NodePath)
        : undefined;
    if (!init?.isObjectExpression() || depth >= MAX_DEPTH) return 'unknown';
    const found = methodOf(init, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

/** The function a binding holds, through `const` aliases. */
const functionOf = (binding: Binding | undefined): NodePath | undefined => {
  for (let hop = 0; binding && hop < MAX_DEPTH; hop += 1) {
    const declared = binding.path;
    if (declared.isFunctionDeclaration()) return declared;
    if (!declared.isVariableDeclarator() || binding.kind !== 'const') return;
    const init = declared.get('init') as NodePath;
    let value = init;
    while (unwrapExpression(value.node, true) !== value.node)
      value = value.get('expression') as NodePath;
    if (value.isFunction()) return value;
    if (!value.isIdentifier()) return;
    binding = value.scope.getBinding(value.node.name);
  }
  return undefined;
};

/**
 * Whether a reference only reads its value in place: it is called, compared,
 * tested, written through, read as a member, or exported. Anything else (an
 * argument, a literal element, a spread) lets another name in this module
 * reach it.
 */
const isReadOnlyUse = (reference: NodePath): boolean => {
  const parent = reference.parent;
  const node = reference.node;
  return (
    // Exports: writes by importing modules are not tracked (documented).
    !t.isExpression(node) ||
    t.isExportSpecifier(parent) ||
    t.isExportDefaultDeclaration(parent) ||
    (t.isCallExpression(parent) && parent.callee === node) ||
    ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
      parent.object === node) ||
    t.isExpressionStatement(parent) ||
    t.isUnaryExpression(parent) ||
    t.isBinaryExpression(parent) ||
    t.isTemplateLiteral(parent) ||
    (t.isAssignmentExpression(parent) && parent.left === node) ||
    (t.isUpdateExpression(parent) && parent.argument === node) ||
    ((t.isIfStatement(parent) ||
      t.isConditionalExpression(parent) ||
      t.isWhileStatement(parent) ||
      t.isDoWhileStatement(parent) ||
      t.isForStatement(parent)) &&
      'test' in parent &&
      parent.test === node) ||
    (t.isSwitchStatement(parent) && parent.discriminant === node)
  );
};

const aliasCache = new WeakMap<
  Binding,
  { binding: Binding; prefix: readonly string[] }[] | undefined
>();
const aliasesOf = (
  binding: Binding,
  writes: ReadonlyMap<Binding, readonly MemberWrite[]>,
): { binding: Binding; prefix: readonly string[] }[] | undefined => {
  // Without member writes in the module, nothing reaches through an alias.
  if (writes.size === 0) return [{ binding, prefix: [] }];
  // A write through a computed receiver may land on any object.
  if (writes.has(OPAQUE_RECEIVER)) return undefined;
  if (aliasCache.has(binding)) return aliasCache.get(binding);
  const result = collectAliases(binding, writes);
  aliasCache.set(binding, result);
  return result;
};
interface AliasFlow {
  /** The binding now holds the source at member `prefix` (if not `dynamic`). */
  readonly binding: Binding;
  readonly prefix: readonly string[];
  /** It holds an unknown member of the source (`source[key]`). */
  readonly dynamic: boolean;
  /**
   * It holds the source `depth` levels down, inside literals or containers
   * (`holder = { source }` is depth 1). Only writes deeper than that can
   * mutate the source; `holder.key = v` merely replaces a slot.
   */
  readonly depth: number;
}

const collectAliases = (
  binding: Binding,
  writes: ReadonlyMap<Binding, readonly MemberWrite[]>,
): { binding: Binding; prefix: readonly string[] }[] | undefined => {
  const found: AliasFlow[] = [
    { binding, prefix: [], dynamic: false, depth: 0 },
  ];
  // The value reached a function this analysis cannot see into.
  let escaped = false;
  const add = (entry: AliasFlow) => {
    if (
      !found.some(
        known =>
          known.binding === entry.binding &&
          known.dynamic === entry.dynamic &&
          known.depth === entry.depth &&
          JSON.stringify(known.prefix) === JSON.stringify(entry.prefix),
      )
    )
      found.push(entry);
  };
  // Self-referential aliases (`alias = alias.child`) would grow forever.
  for (let index = 0; index < found.length && index < MAX_ALIASES; index += 1)
    for (const start of found[index]!.binding.referencePaths) {
      const origin = found[index]!;
      const pending = [
        {
          reference: start as NodePath,
          path: [...origin.prefix],
          dynamic: origin.dynamic,
          depth: origin.depth,
        },
      ];
      const returnedFrom = new Set<t.Node>();
      for (let flow = pending.pop(); flow; flow = pending.pop()) {
        let { reference, dynamic, depth } = flow;
        const { path } = flow;
        const holds = (holder: Binding | undefined, deeper: number) => {
          if (holder)
            add({
              binding: holder,
              prefix: path,
              dynamic,
              depth: depth + deeper,
            });
        };
        /** Each binding a pattern takes from the value, reading its path. */
        const into = (
          pattern: t.Node,
          lookup: (name: string) => Binding | undefined,
        ) => {
          for (const identifier of Object.values(
            t.getBindingIdentifiers(pattern),
          )) {
            const route = patternPath(pattern, identifier);
            const alias = lookup(identifier.name);
            if (route === undefined || !alias) continue;
            if (route === 'dynamic') {
              add({ binding: alias, prefix: path, dynamic: true, depth });
              continue;
            }
            // Reads inside a holder consume containment first.
            const consumed = Math.min(depth, route.members.length);
            add({
              binding: alias,
              prefix: [...path, ...route.members.slice(consumed)],
              dynamic,
              depth: depth - consumed,
            });
          }
        };
        for (;;) {
          const parent = reference.parent;
          const up = reference.parentPath;
          if (!up) break;
          // TS wrappers, branches, awaits and the last sequence expression
          // pass the value through unchanged.
          if (
            unwrapExpression(parent, true) !== parent ||
            (t.isConditionalExpression(parent) &&
              parent.test !== reference.node) ||
            t.isLogicalExpression(parent) ||
            t.isAwaitExpression(parent) ||
            (t.isSequenceExpression(parent) &&
              parent.expressions.at(-1) === reference.node)
          ) {
            reference = up;
            continue;
          }
          // Member reads narrow the value (`binding.a[key]`).
          if (
            (t.isMemberExpression(parent) ||
              t.isOptionalMemberExpression(parent)) &&
            parent.object === reference.node
          ) {
            // A built-in container method (`values.at(0)`) may return the
            // stored value in a way this analysis does not model.
            if (
              depth > 0 &&
              (t.isCallExpression(up.parent) ||
                t.isOptionalCallExpression(up.parent)) &&
              up.parent.callee === parent &&
              CONTAINER_EXTRACTORS.has(staticKey(parent) ?? '')
            ) {
              escaped = true;
              break;
            }
            // Inside a holder, a member read may extract the stored value.
            if (depth > 0) depth -= 1;
            else {
              const name = staticKey(parent);
              if (name === undefined) dynamic = true;
              else path.push(name);
            }
            reference = up;
            continue;
          }
          // Returned: continue from every known call of the function.
          if (
            (t.isReturnStatement(parent) &&
              parent.argument === reference.node) ||
            (t.isArrowFunctionExpression(parent) &&
              parent.body === reference.node)
          ) {
            const fn = reference.getFunctionParent();
            if (fn && !returnedFrom.has(fn.node)) {
              returnedFrom.add(fn.node);
              const sites = callSitesOf(fn);
              escaped ||= sites.escaped;
              for (const call of sites.calls)
                pending.push({
                  reference: call,
                  path: [...path],
                  dynamic,
                  depth,
                });
            }
            break;
          }
          // Stored in a literal: the literal holds it one level down.
          if (
            (t.isObjectProperty(parent) &&
              parent.value === reference.node &&
              t.isObjectExpression(up.parent)) ||
            (t.isSpreadElement(parent) && t.isObjectExpression(up.parent))
          ) {
            // A spread copies the slots, so the copy holds the same members
            // one level down, just like a property.
            reference = up.parentPath!;
            depth += 1;
            continue;
          }
          if (
            t.isArrayExpression(parent) ||
            (t.isSpreadElement(parent) && t.isArrayExpression(up.parent))
          ) {
            reference = t.isSpreadElement(parent) ? up.parentPath! : up;
            depth += 1;
            continue;
          }
          // Spread into call arguments: which parameter receives what is not
          // modeled.
          if (t.isSpreadElement(parent)) {
            escaped = true;
            break;
          }
          // Passed to a call: a local function's parameter receives it, a
          // receiver (`list.push(value)`) may keep it, and the result may be it.
          if (
            (t.isCallExpression(parent) ||
              t.isOptionalCallExpression(parent) ||
              t.isNewExpression(parent)) &&
            parent.callee !== reference.node
          ) {
            let calleePath = up.get('callee') as NodePath;
            while (unwrapExpression(calleePath.node, true) !== calleePath.node)
              calleePath = calleePath.get('expression') as NodePath;
            const callee = calleePath.node;
            const member =
              t.isMemberExpression(callee) ||
              t.isOptionalMemberExpression(callee);
            const receiver = member ? writeTarget(callee)?.root : undefined;
            if (receiver) holds(reference.scope.getBinding(receiver.name), 1);
            // `fn(value)`, `(value => ...)(value)` or `object.method(value)`
            // on a `const` literal.
            const receiverObject = member
              ? unwrapExpression(callee.object, true)
              : undefined;
            const method =
              member &&
              (t.isIdentifier(receiverObject) ||
                t.isObjectExpression(receiverObject))
                ? staticKey(callee)
                : undefined;
            let fn = t.isIdentifier(callee)
              ? reference.scope.getBinding(callee.name)
              : t.isIdentifier(receiverObject)
                ? reference.scope.getBinding(receiverObject.name)
                : undefined;
            // Follow `const` aliases (`const indirect = set`) to the callee.
            for (let hop = 0; fn && hop < MAX_DEPTH; hop += 1) {
              const aliased = fn.path.isVariableDeclarator()
                ? unwrapExpression(fn.path.node.init ?? fn.path.node.id, true)
                : undefined;
              if (fn.kind !== 'const' || !t.isIdentifier(aliased)) break;
              const next = fn.path.scope.getBinding(aliased.name);
              if (!next || next === fn) break;
              fn = next;
            }
            const declared = fn?.path;
            const init = declared?.isVariableDeclarator()
              ? declared.get('init')
              : undefined;
            // `({ set() {} }).set(value)` reads the inline literal itself.
            let literal = init as NodePath | undefined;
            if (t.isObjectExpression(receiverObject)) {
              literal = calleePath.get('object') as NodePath;
              while (unwrapExpression(literal.node, true) !== literal.node)
                literal = literal.get('expression') as NodePath;
            }
            const lookup =
              method !== undefined && literal?.isObjectExpression()
                ? methodOf(literal, method)
                : undefined;
            if (lookup === 'unknown') escaped = true;
            const property = lookup === 'unknown' ? undefined : lookup;
            // A property holding a function by name (`{ mutate }`) runs it.
            const held = property?.isObjectProperty()
              ? (property.get('value') as NodePath)
              : property;
            const heldName = held?.isIdentifier() ? held.node.name : undefined;
            const heldFunction = heldName
              ? functionOf(held!.scope.getBinding(heldName))
              : undefined;
            const target = calleePath.isFunction()
              ? calleePath
              : method !== undefined
                ? heldName
                  ? heldFunction
                  : held
                : declared?.isFunctionDeclaration()
                  ? declared
                  : init;
            if (heldName && !heldFunction?.isFunction()) {
              const binding = held!.scope.getBinding(heldName);
              if (binding && binding.kind !== 'module') escaped = true;
            }
            // A callee that may be a local function this cannot see into (a
            // parameter, a reassignable binding, a computed callee) may keep
            // the value.
            const initValue = init?.node
              ? unwrapExpression(init.node, true)
              : undefined;
            const unseen =
              !target?.isFunction() &&
              (['param', 'let', 'var'].includes(fn?.kind ?? '') ||
                (!t.isIdentifier(callee) && !member) ||
                // A method on a computed or nested local receiver.
                (member &&
                  !t.isIdentifier(receiverObject) &&
                  !t.isObjectExpression(receiverObject) &&
                  (receiver === undefined ||
                    reference.scope.getBinding(receiver.name)?.kind !==
                      'module')) ||
                // A method on a local instance or factory result
                // (`new Local()`, `make()`) may be a local function.
                (method !== undefined &&
                  fn?.kind === 'const' &&
                  !property &&
                  (t.isNewExpression(initValue) ||
                    t.isCallExpression(initValue)) &&
                  (() => {
                    const root = writeTarget(
                      unwrapExpression(initValue.callee, true),
                    )?.root;
                    const owner = root
                      ? fn.path.scope.getBinding(root.name)
                      : undefined;
                    return (
                      !root || (owner !== undefined && owner.kind !== 'module')
                    );
                  })()) ||
                // A `const` holding a call result may be a local closure.
                (fn?.kind === 'const' &&
                  method === undefined &&
                  initValue !== undefined &&
                  !t.isMemberExpression(initValue) &&
                  !t.isIdentifier(initValue)));
            if (unseen) escaped = true;
            const index = parent.arguments.indexOf(
              reference.node as (typeof parent.arguments)[number],
            );
            // `fn.call(self, value)` passes `value` as the first parameter;
            // `apply` and `bind` pass it in ways not modeled.
            if (
              (method === 'call' || method === 'apply' || method === 'bind') &&
              t.isIdentifier(receiverObject)
            ) {
              const receiverBinding = reference.scope.getBinding(
                receiverObject.name,
              );
              const invoked = functionOf(receiverBinding);
              const param = invoked?.isFunction()
                ? invoked.node.params[index - 1]
                : undefined;
              if (
                method === 'call' &&
                index >= 1 &&
                param &&
                !t.isRestElement(param) &&
                invoked?.isFunction()
              )
                into(param, name => invoked.scope.getBinding(name));
              else if (receiverBinding && receiverBinding.kind !== 'module')
                escaped = true;
            }
            if (target?.isFunction()) {
              const param = target.node.params[index];
              if (param && !t.isRestElement(param))
                into(param, name => target.scope.getBinding(name));
              else escaped = true;
            }
            reference = up;
            dynamic = true;
            continue;
          }
          // Stored into a member of another binding (`holder.x = value`).
          if (
            t.isAssignmentExpression(parent) &&
            parent.right === reference.node &&
            !t.isIdentifier(parent.left) &&
            !t.isPattern(parent.left)
          ) {
            const stored = writeTarget(parent.left);
            if (stored)
              holds(reference.scope.getBinding(stored.root.name), stored.depth);
            reference = up;
            continue;
          }
          break;
        }
        // The value flows into a declarator, any (logical) assignment, or a
        // destructuring default.
        const parent = reference.parent;
        const target =
          t.isVariableDeclarator(parent) && parent.init === reference.node
            ? parent.id
            : (t.isAssignmentExpression(parent) &&
                  ['=', '&&=', '||=', '??='].includes(parent.operator)) ||
                t.isAssignmentPattern(parent)
              ? parent.right === reference.node
                ? parent.left
                : undefined
              : undefined;
        if (!t.isLVal(target)) continue;
        into(target, name => reference.scope.getBinding(name));
        // `(a = value)` is itself the value for its parent.
        if (t.isAssignmentExpression(parent) && reference.parentPath)
          pending.push({
            reference: reference.parentPath,
            path: [...path],
            dynamic,
            depth,
          });
      }
    }
  // A holder or an unknown-member alias is written deep enough to reach the
  // source; or the source escaped into code that may write through any name.
  const reaches = (entry: AliasFlow) =>
    (writes.get(entry.binding) ?? []).some(write =>
      entry.depth === 0 ? entry.dynamic : write.depth > entry.depth,
    );
  const tracked = new Set(found.map(entry => entry.binding));
  if (
    found.length > MAX_ALIASES ||
    found.some(reaches) ||
    (escaped && [...writes.keys()].some(owner => !tracked.has(owner)))
  )
    return undefined;
  return found.filter(entry => !entry.dynamic && entry.depth === 0);
};

/**
 * The workspace module graph. Each module is parsed once per graph; an
 * unreadable module stays unresolved instead of assumed valid.
 */
export function createModuleGraph(): ModuleGraph {
  const modules = new Map<
    string,
    { module: SourceModule; facts: ModuleFacts } | SourceSyntaxError
  >();
  const facts = new WeakMap<SourceModule, ModuleFacts>();
  const workspaces = new Map<string, string | undefined>();
  const load = (filePath: string, boundary?: string): SourceModule => {
    const real = fs.realpathSync(filePath);
    let entry = modules.get(real);
    if (entry === undefined) {
      const directory = path.dirname(real);
      if (!workspaces.has(directory))
        workspaces.set(directory, containingWorkspace(real));
      const workspace = workspaces.get(directory);
      try {
        const parsed = parseModule(real, workspace);
        const module: SourceModule = {
          file: parsed.file,
          path: real,
          boundary: boundary ?? sourceBoundary(real, workspace),
          mutations: parsed.mutations,
        };
        facts.set(module, parsed.facts);
        entry = { module, facts: parsed.facts };
      } catch (error) {
        if (!(error instanceof SourceSyntaxError)) throw error;
        entry = error;
      }
      modules.set(real, entry);
    }
    if (entry instanceof SourceSyntaxError) throw entry;
    return entry.module;
  };
  const factsOf = (module: SourceModule): ModuleFacts => {
    const known = facts.get(module);
    if (known) return known;
    throw new Error(`${module.path}: module does not belong to this graph`);
  };
  /** A traversal edge to `specifier`; unreadable targets are undefined. */
  const follow = (
    module: SourceModule,
    specifier: string,
  ): SourceModule | 'external' | undefined => {
    const target = resolveModulePath(
      module,
      specifier,
      factsOf(module).workspace,
    );
    if (target?.kind === 'external') return 'external';
    if (target === undefined) return undefined;
    try {
      return load(target.path, target.boundary);
    } catch (error) {
      if (error instanceof SourceSyntaxError) return undefined;
      throw error;
    }
  };
  const mutated = (module: SourceModule, binding: Binding): boolean =>
    binding.constantViolations.length > 0 ||
    factsOf(module).merged.has(binding.identifier.name) ||
    (aliasesOf(binding, factsOf(module).writes)?.some(alias =>
      factsOf(module).writes.has(alias.binding),
    ) ??
      true);

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
    const throughModule = (
      specifier: string,
      imported: string,
      allowExternal: boolean,
    ): ResolvedBinding | undefined => {
      const next = follow(module, specifier);
      if (next === 'external')
        return allowExternal
          ? { kind: 'external', specifier, name: imported, chain: hops }
          : undefined;
      return next === undefined
        ? undefined
        : resolveBinding(next, imported, 'export', hops, seen);
    };
    if (scope === 'local') {
      const binding = factsOf(module).scope.getBinding(name);
      if (!binding || mutated(module, binding)) return undefined;
      if (binding.kind === 'module') {
        const imported = importOf(binding);
        return imported === undefined || imported.name === '*'
          ? undefined
          : throughModule(imported.specifier, imported.name, true);
      }
      const declarator = binding.path.node;
      return binding.kind === 'const' &&
        t.isVariableDeclarator(declarator) &&
        t.isIdentifier(declarator.id) &&
        declarator.init
        ? {
            kind: 'declaration',
            expression: declarator.init,
            module,
            chain: hops,
          }
        : undefined;
    }
    const hop = exportHop(module.file, name);
    if (hop?.kind === 'local')
      return resolveBinding(module, hop.name, 'local', hops, seen);
    if (hop?.kind === 'reexport')
      return throughModule(hop.specifier, hop.name, true);
    if (hop?.kind === 'node')
      return t.isExpression(hop.node)
        ? { kind: 'declaration', expression: hop.node, module, chain: hops }
        : undefined;
    if (hop !== undefined) return undefined;
    // `export *` from a package cannot prove the package exports `name`.
    for (const specifier of starSources(module.file, name)) {
      const resolved = throughModule(specifier, name, false);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  };

  /** One evaluation query: shared cycle guard and budget. */
  /**
   * One query. `walking` (for `reachable`) also yields the values written
   * into deeper members of a binding, since walking an object reaches them.
   */
  const evaluation = (walking: boolean) => {
    const active = new Set<string>();
    /** Parameters bound to call arguments while following a local call. */
    interface BoundParameter {
      /** The parameter pattern the binding sits in. */
      readonly pattern: t.Node;
      /** The caller's argument; undefined when omitted. */
      readonly argument?: { module: SourceModule; node: t.Node };
      /** The frame in effect at the call site, for the argument. */
      readonly context: Frame;
    }
    interface Frame {
      readonly id: number;
      readonly parameters: ReadonlyMap<Binding, BoundParameter>;
    }
    // One frame per followed call, so recursion binds its own arguments.
    let frames = 0;
    let frame: Frame = { id: 0, parameters: new Map() };
    let steps = 0;
    /** One call argument, with the module and frame it is evaluated in. */
    interface CallArgument {
      readonly module: SourceModule;
      readonly node: t.Node;
      readonly context: Frame;
    }
    /** Arguments `fn.bind(self, ...args)` captured for the returned value. */
    const boundArguments = new WeakMap<GraphValue, readonly CallArgument[]>();
    /** The frame a returned closure was created in, for its captured parameters. */
    const closureFrames = new WeakMap<GraphValue, Frame>();
    const unresolved = (module: SourceModule, node: t.Node): GraphValue[] => [
      { kind: 'unresolved', node, module },
    ];

    const namespaceValues = (
      module: SourceModule,
      specifier: string,
      members: readonly string[],
      at: t.Node,
    ): GraphValue[] => {
      const next = follow(module, specifier);
      if (next === 'external')
        return [
          members.length === 0
            ? { kind: 'external', specifier, name: '*', members: [] }
            : {
                kind: 'external',
                specifier,
                name: members[0]!,
                members: members.slice(1),
              },
        ];
      if (next === undefined) return unresolved(module, at);
      // `module.exports = value` is the whole CommonJS namespace; a walk also
      // reaches the values written below it.
      if (members.length === 0) {
        const written = (write: MemberWrite) =>
          write.value
            ? values(next, write.value, [...(write.from ?? [])])
            : unresolved(next, write.node);
        const whole = factsOf(next).commonJs.filter(
          write => write.path.length === 0 && !write.dynamic,
        );
        const found = whole.flatMap(written);
        if (walking) {
          for (const write of factsOf(next).commonJs)
            if (write.path.length > 0 || write.dynamic)
              found.push(...written(write));
          // An ESM namespace reaches every export it provides.
          const key = `namespace:${next.path}`;
          if (!active.has(key)) {
            active.add(key);
            try {
              for (const name of exportNames(next.file))
                found.push(...(exportValues(next, name, []) ?? []));
              for (const specifier of starSources(next.file, ''))
                found.push(...namespaceValues(next, specifier, [], at));
            } finally {
              active.delete(key);
            }
          }
        }
        return whole.length > 0 ? found : [...unresolved(module, at), ...found];
      }
      return (
        exportValues(next, members[0]!, members.slice(1)) ??
        unresolved(module, at)
      );
    };

    const importValues = (
      module: SourceModule,
      specifier: string,
      name: string,
      members: readonly string[],
      at: t.Node,
    ): GraphValue[] => {
      if (name === '*') return namespaceValues(module, specifier, members, at);
      const next = follow(module, specifier);
      if (next === 'external')
        return [{ kind: 'external', specifier, name, members }];
      return (
        (next && exportValues(next, name, members)) ?? unresolved(module, at)
      );
    };

    /** Undefined when `module` does not export `name` at all. */
    const exportValues = (
      module: SourceModule,
      name: string,
      members: readonly string[],
    ): GraphValue[] | undefined => {
      // A re-export or `export *` cycle provides nothing the other edges do not.
      const key = `export:${module.path}#${name}:${members.join('.')}`;
      if (active.has(key)) return undefined;
      if (++steps > MAX_LOOKUPS || active.size >= MAX_DEPTH)
        return unresolved(module, module.file);
      active.add(key);
      try {
        return exportedValues(module, name, members);
      } finally {
        active.delete(key);
      }
    };
    const exportedValues = (
      module: SourceModule,
      name: string,
      members: readonly string[],
    ): GraphValue[] | undefined => {
      const hop = exportHop(module.file, name);
      if (hop?.kind === 'local') {
        const binding = factsOf(module).scope.getBinding(hop.name);
        return binding
          ? bindingValues(module, binding, members, binding.identifier)
          : unresolved(module, module.file);
      }
      if (hop?.kind === 'reexport')
        return importValues(
          module,
          hop.specifier,
          hop.name,
          members,
          module.file,
        );
      if (hop?.kind === 'namespace')
        return namespaceValues(module, hop.specifier, members, module.file);
      if (hop?.kind === 'node') return values(module, hop.node, members);
      for (const specifier of starSources(module.file, name)) {
        const next = follow(module, specifier);
        const found =
          next === undefined || next === 'external'
            ? undefined
            : exportValues(next, name, members);
        if (found !== undefined) return found;
      }
      return commonJsExport(module, name, members);
    };

    /** A CommonJS export `name`, or undefined when the module has none. */
    const commonJsExport = (
      module: SourceModule,
      name: string,
      members: readonly string[],
    ): GraphValue[] | undefined => {
      const found: GraphValue[] = [];
      // A default import of CommonJS reads `module.exports` itself, or an
      // explicit `exports.default`.
      for (const [requested, explicit] of name === 'default'
        ? ([
            [[...members], false],
            [['default', ...members], true],
          ] as const)
        : ([[[name, ...members], false]] as const))
        for (const write of factsOf(module).commonJs) {
          // `exports.default` is read only from writes that name it.
          if (explicit && write.path.length === 0) continue;
          const reads = write.path.length <= requested.length;
          const [shorter, longer] = reads
            ? [write.path, requested]
            : [requested, write.path];
          if (
            (!reads && !walking) ||
            shorter.some((key, index) => longer[index] !== key)
          )
            continue;
          found.push(
            ...(write.dynamic || !write.value
              ? unresolved(module, write.node)
              : values(module, write.value, [
                  ...(write.from ?? []),
                  ...(reads ? requested.slice(write.path.length) : []),
                ])),
          );
        }
      return found.length > 0 ? found : undefined;
    };

    const bindingValues = (
      module: SourceModule,
      binding: Binding,
      members: readonly string[],
      at: t.Node,
    ): GraphValue[] => {
      const moduleFacts = factsOf(module);
      if (
        binding.scope === moduleFacts.scope &&
        moduleFacts.merged.has(binding.identifier.name)
      )
        return unresolved(module, at);
      const found: GraphValue[] = [];
      const node = binding.path.node;
      if (binding.kind === 'module') {
        const imported = importOf(binding);
        found.push(
          ...(imported === undefined
            ? unresolved(module, at)
            : importValues(
                module,
                imported.specifier,
                imported.name,
                members,
                binding.path.parent,
              )),
        );
      } else if (t.isVariableDeclarator(node)) {
        const route = patternPath(node.id, binding.identifier);
        const rest =
          route === 'dynamic' && node.init && members.length > 0
            ? objectRestPath(node.id, binding.identifier)
            : undefined;
        // `rest.key` reads `source.key` unless the pattern names `key`.
        if (rest && !rest.excluded.has(members[0]!))
          found.push(
            ...values(module, node.init!, [...rest.members, ...members]),
          );
        else if (route === undefined || route === 'dynamic')
          found.push(...unresolved(module, at));
        else {
          if (node.init)
            found.push(
              ...values(module, node.init, [...route.members, ...members]),
            );
          // `declare const`, `let x;` without writes, and loop variables.
          else if (
            binding.constantViolations.length === 0 ||
            t.isForXStatement(binding.path.parentPath?.parent)
          )
            found.push(...unresolved(module, at));
          for (const fallback of route.defaults)
            found.push(
              ...values(module, fallback.value, [
                ...route.members.slice(fallback.members.length),
                ...members,
              ]),
            );
        }
      } else if (t.isClassDeclaration(node) && members.length > 0)
        found.push(...staticMemberValues(module, node, members));
      else if (t.isFunctionDeclaration(node) || t.isClassDeclaration(node))
        found.push(
          ...(members.length === 0
            ? [{ kind: 'node' as const, node, module }]
            : unresolved(module, at)),
        );
      else {
        // A parameter of a function being followed from a call site has the
        // caller's argument as its value.
        const parameter =
          binding.kind === 'param' ? frame.parameters.get(binding) : undefined;
        const route = parameter
          ? patternPath(parameter.pattern, binding.identifier)
          : undefined;
        if (!parameter || !route || route === 'dynamic')
          found.push(...unresolved(module, at));
        else {
          const { argument } = parameter;
          if (argument) {
            const current = frame;
            frame = parameter.context;
            try {
              found.push(
                ...values(argument.module, argument.node, [
                  ...route.members,
                  ...members,
                ]),
              );
            } finally {
              frame = current;
            }
          } else if (route.defaults.length === 0)
            found.push(...unresolved(module, at));
          for (const fallback of route.defaults)
            found.push(
              ...values(module, fallback.value, [
                ...route.members.slice(fallback.members.length),
                ...members,
              ]),
            );
        }
      }
      for (const violation of binding.constantViolations) {
        const write = violation.node;
        const target =
          t.isAssignmentExpression(write) &&
          ['=', '&&=', '||=', '??='].includes(write.operator)
            ? t.getBindingIdentifiers(write.left)[binding.identifier.name]
            : undefined;
        // Destructuring assignment (`({ get } = source)`) reads a path.
        const route =
          target && t.isAssignmentExpression(write)
            ? patternPath(write.left, target)
            : undefined;
        if (!route || route === 'dynamic' || !t.isAssignmentExpression(write)) {
          found.push(...unresolved(module, write));
          continue;
        }
        found.push(
          ...values(module, write.right, [...route.members, ...members]),
        );
        for (const fallback of route.defaults)
          found.push(
            ...values(module, fallback.value, [
              ...route.members.slice(fallback.members.length),
              ...members,
            ]),
          );
      }
      const aliases = aliasesOf(binding, moduleFacts.writes);
      if (!aliases) found.push(...unresolved(module, at));
      for (const write of (aliases ?? []).flatMap(alias =>
        (moduleFacts.writes.get(alias.binding) ?? []).map(entry => ({
          ...entry,
          path: [...alias.prefix, ...entry.path],
        })),
      )) {
        // `reads`: the write lands on the member being read or on one of its
        // owners. Otherwise it lands deeper, which only a walk reaches.
        const reads = write.dynamic
          ? write.path.length < members.length
          : write.path.length <= members.length;
        const [shorter, longer] = reads
          ? [write.path, members]
          : [members, write.path];
        if (
          (!reads && !walking) ||
          shorter.some((name, index) => longer[index] !== name)
        )
          continue;
        // A computed key may or may not name the member being read.
        if (write.dynamic && reads)
          found.push(...unresolved(module, write.node));
        found.push(
          ...(write.value === undefined
            ? unresolved(module, write.node)
            : values(module, write.value, [
                ...(write.from ?? []),
                ...(reads
                  ? members.slice(write.path.length + (write.dynamic ? 1 : 0))
                  : []),
              ])),
        );
      }
      return found;
    };

    const propertyValues = (
      module: SourceModule,
      object: t.ObjectExpression,
      members: readonly string[],
    ): GraphValue[] => {
      const [name, ...rest] = members;
      // Later properties override earlier ones, so read from the last one
      // back and stop at the first that definitely defines `name`.
      const found: GraphValue[][] = [];
      for (const property of object.properties.toReversed()) {
        if (t.isSpreadElement(property)) {
          found.push(values(module, property.argument, members));
          // A spread of object literals that all define `name` shadows
          // every earlier property.
          const spread = values(module, property.argument, []);
          if (
            name !== undefined &&
            spread.length > 0 &&
            spread.every(
              value =>
                value.kind === 'node' &&
                t.isObjectExpression(value.node) &&
                value.node.properties.some(
                  entry =>
                    !t.isSpreadElement(entry) &&
                    staticKey(entry) === name &&
                    !(t.isObjectMethod(entry) && entry.kind === 'set'),
                ),
            )
          )
            break;
          continue;
        }
        // A dynamic key may name any member, so it is always a possibility.
        const key = staticKey(property);
        if (key === undefined) {
          found.push(unresolved(module, property));
          continue;
        }
        if (key !== name) continue;
        found.push(
          t.isObjectMethod(property)
            ? property.kind === 'get'
              ? returnValues(module, property, rest)
              : rest.length === 0
                ? [{ kind: 'node' as const, node: property, module }]
                : unresolved(module, property)
            : values(module, property.value, rest),
        );
        // A setter alone does not define what a read returns.
        if (!t.isObjectMethod(property) || property.kind !== 'set') break;
      }
      const ordered = found.toReversed().flat();
      return ordered.length > 0 ? ordered : unresolved(module, object);
    };

    /**
     * A static member of a class declaration: `static get = value`, a static
     * method, or a static getter. A superclass, a static block or a computed
     * static key may also supply it, so those keep it unresolved as well.
     */
    const staticMemberValues = (
      module: SourceModule,
      declaration: t.ClassDeclaration,
      members: readonly string[],
    ): GraphValue[] => {
      const [name, ...rest] = members;
      const found: GraphValue[] = [];
      let definite = false;
      for (const member of declaration.body.body) {
        if (t.isStaticBlock(member)) {
          found.push(...unresolved(module, member));
          continue;
        }
        if (
          !(t.isClassProperty(member) || t.isClassMethod(member)) ||
          !member.static
        )
          continue;
        const key = staticKey(member as unknown as t.ObjectProperty);
        if (key === undefined) {
          found.push(...unresolved(module, member));
          continue;
        }
        if (key !== name) continue;
        if (t.isClassProperty(member)) {
          definite = true;
          found.push(
            ...(member.value
              ? values(module, member.value, rest)
              : unresolved(module, member)),
          );
        } else if (member.kind === 'get') {
          definite = true;
          found.push(...returnValues(module, member, rest));
        } else if (member.kind === 'method') {
          definite = true;
          found.push(
            ...(rest.length === 0
              ? [{ kind: 'node' as const, node: member, module }]
              : unresolved(module, member)),
          );
        }
      }
      if (!definite || declaration.superClass)
        found.push(...unresolved(module, declaration));
      return found;
    };

    /** What calling `fn` returns; a bare `return;` or fall-through is unresolved. */
    const returnValues = (
      module: SourceModule,
      fn: t.Function,
      members: readonly string[],
    ): GraphValue[] => {
      const body = fn.body;
      if (t.isExpression(body)) return values(module, body, members);
      const moduleFacts = factsOf(module);
      const found =
        moduleFacts.bareReturns.has(fn) ||
        !(
          t.isReturnStatement(body.body.at(-1)) ||
          t.isThrowStatement(body.body.at(-1))
        )
          ? unresolved(module, fn)
          : [];
      for (const expression of moduleFacts.returns.get(fn) ?? [])
        found.push(...values(module, expression, members));
      return found;
    };

    /** A function value, or an external one, can be run through `call`. */
    const callable = (value: GraphValue) =>
      value.kind === 'external' ||
      (value.kind === 'node' && t.isFunction(value.node));

    const callValues = (
      module: SourceModule,
      call: t.CallExpression | t.OptionalCallExpression,
      members: readonly string[],
    ): GraphValue[] => {
      const found: GraphValue[] = [];
      let terminal = false;
      const argumentsOf = (args: readonly t.Node[]): readonly CallArgument[] =>
        args.map(node => ({ module, node, context: frame }));
      /** Run one callee value with `args`, after any arguments it bound. */
      const run = (callee: GraphValue, callArgs: readonly CallArgument[]) => {
        const args = [...(boundArguments.get(callee) ?? []), ...callArgs];
        // An opaque callee makes the result opaque, not a spelled-out call.
        if (callee.kind === 'unresolved') {
          found.push(...unresolved(module, call));
          return;
        }
        if (callee.kind !== 'node' || !t.isFunction(callee.node)) {
          terminal = true;
          return;
        }
        const outer = frame;
        // A closure also sees the parameters of the call that created it.
        const parameters = new Map([
          ...outer.parameters,
          ...(closureFrames.get(callee)?.parameters ?? []),
        ]);
        const fnScope = factsOf(callee.module).functionScopes.get(callee.node);
        // A spread argument shifts every later parameter.
        const spread = args.findIndex(
          ({ node }) =>
            t.isSpreadElement(node) || t.isArgumentPlaceholder(node),
        );
        callee.node.params.forEach((param, index) => {
          if (spread !== -1 && index >= spread) return;
          const argument = args[index];
          for (const name of Object.keys(t.getBindingIdentifiers(param))) {
            const binding = fnScope?.getOwnBinding(name);
            if (!binding) continue;
            parameters.set(binding, {
              pattern: param,
              argument: argument
                ? { module: argument.module, node: argument.node }
                : undefined,
              context: argument?.context ?? outer,
            });
          }
        });
        const inner: Frame = { id: (frames += 1), parameters };
        frame = inner;
        try {
          for (const value of returnValues(
            callee.module,
            callee.node,
            members,
          )) {
            // A returned function keeps this call's parameters for later calls.
            if (value.kind === 'node' && t.isFunction(value.node)) {
              const closure: GraphValue = { ...value };
              closureFrames.set(closure, inner);
              const bound = boundArguments.get(value);
              if (bound) boundArguments.set(closure, bound);
              found.push(closure);
            } else found.push(value);
          }
        } finally {
          frame = outer;
        }
      };
      const via = unwrapExpression(call.callee, true);
      const invocation =
        (t.isMemberExpression(via) || t.isOptionalMemberExpression(via)) &&
        ['call', 'apply', 'bind'].includes(staticKey(via) ?? '')
          ? { name: staticKey(via), object: via.object }
          : undefined;
      if (!invocation)
        for (const callee of values(module, call.callee, []))
          run(callee, argumentsOf(call.arguments));
      else {
        const receivers = values(module, invocation.object, []);
        // A property that is merely named `call`, `apply` or `bind`.
        if (!receivers.every(callable))
          for (const callee of values(module, invocation.object, [
            invocation.name!,
          ]))
            run(callee, argumentsOf(call.arguments));
        for (const receiver of receivers.filter(callable)) {
          // `fn.bind(self, ...args)` returns `fn` with `args` bound, not its
          // result; later calls pass `args` before their own.
          if (invocation.name === 'bind') {
            if (members.length > 0) {
              found.push(...unresolved(module, call));
              continue;
            }
            const bound = argumentsOf(call.arguments.slice(1));
            if (bound.length === 0) {
              found.push(receiver);
              continue;
            }
            const boundReceiver: GraphValue = { ...receiver };
            const closure = closureFrames.get(receiver);
            if (closure) closureFrames.set(boundReceiver, closure);
            boundArguments.set(boundReceiver, [
              ...(boundArguments.get(receiver) ?? []),
              ...bound,
            ]);
            found.push(boundReceiver);
            continue;
          }
          // `fn.call(self, ...args)` passes `args`; `fn.apply` an array.
          // A literal array passed to `apply` is the argument list.
          const listed = call.arguments[1];
          run(
            receiver,
            argumentsOf(
              invocation.name === 'call'
                ? call.arguments.slice(1)
                : t.isArrayExpression(listed) &&
                    listed.elements.every(
                      element =>
                        element !== null && !t.isSpreadElement(element),
                    )
                  ? (listed.elements as t.Expression[])
                  : [],
            ),
          );
        }
      }
      if (terminal)
        found.push(
          ...(members.length === 0
            ? [{ kind: 'node' as const, node: call, module }]
            : unresolved(module, call)),
        );
      return found;
    };

    /**
     * A key spelled as a literal, a `+` of literals, or a `const` bound to
     * one: `Schema[key]` with `const key = 'Unknown'` reads `Unknown`.
     */
    const constantString = (
      module: SourceModule,
      expression: t.Node,
      depth = 0,
    ): string | undefined => {
      const node = unwrapExpression(expression, true);
      if (depth > MAX_DEPTH) return undefined;
      if (t.isStringLiteral(node)) return node.value;
      if (t.isNumericLiteral(node)) return String(node.value);
      if (t.isTemplateLiteral(node) && node.expressions.length === 0)
        return node.quasis[0]?.value.cooked ?? undefined;
      if (t.isBinaryExpression(node, { operator: '+' })) {
        const left = constantString(module, node.left, depth + 1);
        const right = constantString(module, node.right, depth + 1);
        return left === undefined || right === undefined
          ? undefined
          : left + right;
      }
      if (!t.isIdentifier(node)) return undefined;
      const binding =
        factsOf(module).references.get(node) ??
        factsOf(module).scope.getBinding(node.name);
      const declarator = binding?.path.node;
      return binding?.kind === 'const' &&
        t.isVariableDeclarator(declarator) &&
        declarator.id === binding.identifier &&
        declarator.init
        ? constantString(module, declarator.init, depth + 1)
        : undefined;
    };

    const values = (
      module: SourceModule,
      expression: t.Node,
      members: readonly string[],
    ): GraphValue[] => {
      const node = unwrapExpression(expression, true);
      const key = `${frame.id}:${module.path}:${node.start}:${node.end}:${node.type}:${members.join('.')}`;
      // A recursive value never settles; the cycle is opaque, not empty.
      if (active.has(key)) return unresolved(module, node);
      if (++steps > MAX_LOOKUPS || active.size >= MAX_DEPTH)
        return unresolved(module, node);
      active.add(key);
      try {
        if (t.isIdentifier(node) || t.isJSXIdentifier(node)) {
          const binding =
            factsOf(module).references.get(node) ??
            factsOf(module).scope.getBinding(node.name);
          return binding
            ? bindingValues(module, binding, members, node)
            : unresolved(module, node);
        }
        if (t.isJSXMemberExpression(node))
          return values(module, node.object, [node.property.name, ...members]);
        if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
          const name =
            staticKey(node) ??
            (node.computed ? constantString(module, node.property) : undefined);
          if (name === undefined) return unresolved(module, node);
          // On a function, `call`, `apply` and `bind` run or return it.
          if (
            members.length === 0 &&
            ['call', 'apply', 'bind'].includes(name)
          ) {
            const receivers = values(module, node.object, []);
            const functions = receivers.filter(callable);
            return functions.length === receivers.length
              ? functions
              : [...functions, ...values(module, node.object, [name])];
          }
          return values(module, node.object, [name, ...members]);
        }
        // A static `import('x')` reads module `x` like `import * as`.
        if (t.isImportExpression(node) && t.isStringLiteral(node.source))
          return namespaceValues(module, node.source.value, members, node);
        // A static CommonJS `require('x')` reads module `x` like `import * as`.
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee, { name: 'require' }) &&
          // Only the unbound CommonJS `require`, never a lexical one.
          !(factsOf(module).references.has(node.callee)
            ? factsOf(module).references.get(node.callee)
            : factsOf(module).scope.getBinding('require')) &&
          node.arguments.length === 1 &&
          t.isStringLiteral(node.arguments[0])
        )
          return namespaceValues(
            module,
            node.arguments[0].value,
            members,
            node,
          );
        if (t.isCallExpression(node) || t.isOptionalCallExpression(node))
          return callValues(module, node, members);
        if (t.isConditionalExpression(node))
          return [
            ...values(module, node.consequent, members),
            ...values(module, node.alternate, members),
          ];
        if (t.isLogicalExpression(node))
          return [
            ...values(module, node.left, members),
            ...values(module, node.right, members),
          ];
        // The value model does not distinguish a promise from its result.
        if (t.isAwaitExpression(node))
          return values(module, node.argument, members);
        // `(a = b)` has the value of `b`; compound assignments stay opaque.
        if (t.isAssignmentExpression(node))
          return node.operator === '='
            ? values(module, node.right, members)
            : // `a ??= b` is `a` or `b`.
              ['&&=', '||=', '??='].includes(node.operator)
              ? [
                  ...values(module, node.left, members),
                  ...values(module, node.right, members),
                ]
              : unresolved(module, node);
        if (t.isSequenceExpression(node))
          return values(module, node.expressions.at(-1)!, members);
        if (members.length === 0) return [{ kind: 'node', node, module }];
        if (t.isObjectExpression(node))
          return propertyValues(module, node, members);
        // A static index before any spread names one element.
        const [index, ...rest] = members;
        const element =
          t.isArrayExpression(node) &&
          index !== undefined &&
          /^\d+$/u.test(index)
            ? node.elements.slice(0, Number(index) + 1)
            : undefined;
        return element &&
          element.length === Number(index) + 1 &&
          !element.some(item => t.isSpreadElement(item)) &&
          element.at(-1)
          ? values(module, element.at(-1)!, rest)
          : unresolved(module, node);
      } finally {
        active.delete(key);
      }
    };

    /** Walk `expression`, evaluating each reference and walking what it evaluates to. */
    const reachable = (
      module: SourceModule,
      expression: t.Node,
    ): GraphValue[] => {
      const found: GraphValue[] = [];
      const walked = new Set<string>();
      // An explicit stack: minified or generated sources nest deeper than the call stack.
      const pending: [SourceModule, t.Node][] = [[module, expression]];
      const walk = (owner: SourceModule, node: t.Node) =>
        pending.push([owner, node]);
      for (let next = pending.pop(); next; next = pending.pop()) {
        const [owner, node] = next;
        const key = `${owner.path}:${node.start}:${node.end}:${node.type}`;
        if (walked.has(key)) continue;
        walked.add(key);
        if (walked.size > MAX_LOOKUPS) {
          found.push(...unresolved(owner, node));
          continue;
        }
        const reference =
          ((t.isIdentifier(node) || t.isJSXIdentifier(node)) &&
            factsOf(owner).references.has(node)) ||
          t.isJSXMemberExpression(node) ||
          t.isMemberExpression(node) ||
          t.isOptionalMemberExpression(node);
        const call =
          t.isCallExpression(node) || t.isOptionalCallExpression(node);
        if (reference || call) {
          steps = 0;
          const evaluated = values(owner, node, []);
          for (const value of evaluated)
            if (value.kind !== 'node') found.push(value);
            else if (value.node !== node) walk(value.module, value.node);
          if (reference) {
            if (
              (t.isMemberExpression(node) ||
                t.isOptionalMemberExpression(node) ||
                t.isJSXMemberExpression(node)) &&
              evaluated.some(value => value.kind === 'unresolved')
            ) {
              walk(owner, node.object);
              if (!t.isJSXMemberExpression(node) && node.computed)
                walk(owner, node.property);
            }
            continue;
          }
        }
        // Binding names, globals and types carry no runtime value.
        if (
          t.isIdentifier(node) ||
          (node.type.startsWith('TS') && !t.isExpression(node))
        )
          continue;
        for (const field of t.VISITOR_KEYS[node.type] ?? []) {
          if (
            /^(?:typeAnnotation|returnType|typeParameters|typeArguments|superTypeParameters)$/u.test(
              field,
            )
          )
            continue;
          const child = (node as unknown as Record<string, unknown>)[field];
          for (const item of Array.isArray(child) ? child : [child])
            if (t.isNode(item)) walk(owner, item);
        }
      }
      return found;
    };

    return { values, reachable };
  };

  return {
    module: filePath => load(filePath),
    resolve: (module, name, scope) =>
      resolveBinding(module, name, scope, [], new Set()),
    evaluate: (module, expression) =>
      evaluation(false).values(module, expression, []),
    reachable: (module, expression) =>
      evaluation(true).reachable(module, expression),
  };
}
