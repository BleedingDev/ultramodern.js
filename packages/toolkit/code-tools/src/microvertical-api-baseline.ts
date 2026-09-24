import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as t from '@babel/types';
import { type Exports, exports as resolvePackageExport } from 'resolve.exports';
import { baselinePublicIdentityIsExact } from './microvertical-api-owner.ts';
import {
  parseSource,
  SourceSyntaxError,
  traverseSource,
  unwrapExpression,
} from './source-analysis.ts';

type Node = t.Node;
type Expression = t.Node;
type SourceFile = t.File;
type VariableDeclaration = t.VariableDeclarator;
type PropertyAssignment = t.ObjectProperty;
type ObjectLiteralExpression = t.ObjectExpression;
type ObjectLiteralElementLike =
  | t.ObjectMethod
  | t.ObjectProperty
  | t.SpreadElement;
type CallExpression = t.CallExpression;

function parseConsumer(filePath: string): t.File {
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

const camelCaseStem = (stem: string): string =>
  stem.replaceAll(/-([a-z0-9])/gu, (_match, letter: string) =>
    letter.toUpperCase(),
  );

const pascalCaseStem = (stem: string): string => {
  const camelStem = camelCaseStem(stem);
  return `${camelStem.slice(0, 1).toUpperCase()}${camelStem.slice(1)}`;
};

const identifierName = (node: Node | undefined): string | undefined =>
  node !== undefined && t.isIdentifier(node) ? node.name : undefined;

const propertyName = (node: Node | undefined): string | undefined => {
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

const accessPath = (node: Expression): readonly string[] | undefined => {
  if (t.isIdentifier(node)) {
    return [node.name];
  }
  if (
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isIdentifier(node.property)
  ) {
    const parent = accessPath(node.object);
    return parent === undefined ? undefined : [...parent, node.property.name];
  }
  return undefined;
};

const isAccessPath = (node: Expression, expected: readonly string[]): boolean =>
  accessPath(node)?.join('.') === expected.join('.');

const stringLiteral = (
  expression: Expression | null | undefined,
): string | undefined => {
  if (expression == null) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expression);
  return t.isStringLiteral(unwrapped) ? unwrapped.value : undefined;
};

const numericLiteral = (
  expression: Expression | null | undefined,
): number | undefined => {
  if (expression == null) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expression);
  return t.isNumericLiteral(unwrapped) ? Number(unwrapped.value) : undefined;
};

const callExpression = (
  expression: Expression | null | undefined,
  callee: readonly string[],
): CallExpression | undefined => {
  if (expression == null) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expression);
  return t.isCallExpression(unwrapped) && isAccessPath(unwrapped.callee, callee)
    ? unwrapped
    : undefined;
};

const localConst = (
  sourceFile: SourceFile,
  name: string,
): VariableDeclaration | undefined => {
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
const exportedConst = (
  sourceFile: SourceFile,
  name: string,
): VariableDeclaration | undefined => {
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

interface ConsumerModule {
  readonly file: SourceFile;
  readonly path: string;
  readonly boundary: string;
}

interface ResolvedBinding {
  readonly expression: Expression;
  readonly module: ConsumerModule;
}

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

/** Public package exports are the only cross-package source traversal edge. */
const resolveModulePath = (
  module: ConsumerModule,
  specifier: string,
  workspace?: string,
): { path: string; boundary: string } | undefined => {
  if (/^\.\.?\//u.test(specifier)) {
    const file = sourceFileAt(
      path.resolve(path.dirname(module.path), specifier),
      module.boundary,
    );
    return file === undefined
      ? undefined
      : { path: file, boundary: module.boundary };
  }
  const entry = packageEntry(specifier);
  if (!entry || !workspace) return undefined;
  const paths = createRequire(module.path).resolve.paths(entry.name) ?? [];
  for (const lookup of paths) {
    const directory = path.join(lookup, entry.name);
    const manifest = path.join(directory, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const boundary = fs.realpathSync(directory);
    // Installed third-party dependencies and a sibling's private paths cannot
    // become declarations in this workspace's composed API.
    if (
      !inside(boundary, workspace) ||
      boundary.split(path.sep).includes('node_modules')
    )
      return undefined;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      name: string;
      exports?: Exports;
    };
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
    return file === undefined ? undefined : { path: file, boundary };
  }
  return undefined;
};

/** Parse each composed module once; an unreadable module stays unresolved instead of assumed valid. */
const createModuleReader = (root: ConsumerModule) => {
  const modules = new Map<string, ConsumerModule | undefined>([
    [root.path, root],
  ]);
  return (filePath: string, boundary: string): ConsumerModule | undefined => {
    if (modules.has(filePath)) return modules.get(filePath);
    if (modules.size >= 256) return undefined;
    let module: ConsumerModule | undefined;
    try {
      module = { file: parseConsumer(filePath), path: filePath, boundary };
    } catch {
      module = undefined;
    }
    modules.set(filePath, module);
    return module;
  };
};

const importedBinding = (
  module: ConsumerModule,
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
  module: ConsumerModule,
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
  module: ConsumerModule,
): Expression | string | undefined => {
  for (const statement of module.file.program.body) {
    if (!t.isExportDefaultDeclaration(statement)) continue;
    const declaration = statement.declaration;
    if (t.isIdentifier(declaration)) return declaration.name;
    return t.isExpression(declaration) ? declaration : undefined;
  }
  return undefined;
};

/**
 * Resolve a contract identifier to its declaration, following relative imports
 * and re-exports so a root API may compose sub-APIs declared in sibling modules.
 * Every bounded-endpoint check still runs against the resolved declaration, and
 * an identifier this cannot resolve stays unresolved so the rule still fails.
 */
const resolveBinding = (
  module: ConsumerModule,
  name: string,
  scope: 'export' | 'local',
  readModule: (
    filePath: string,
    boundary: string,
  ) => ConsumerModule | undefined,
  workspace: string | undefined,
  seen: Set<string>,
): ResolvedBinding | undefined => {
  const key = `${scope}:${module.path}#${name}`;
  if (seen.has(key) || seen.size >= 512) return undefined;
  seen.add(key);
  const declaration =
    scope === 'export'
      ? exportedConst(module.file, name)
      : localConst(module.file, name);
  if (declaration?.init) return { expression: declaration.init, module };
  const throughModule = (
    specifier: string,
    imported: string,
  ): ResolvedBinding | undefined => {
    const resolved = resolveModulePath(module, specifier, workspace);
    const target = resolved && readModule(resolved.path, resolved.boundary);
    return target === undefined
      ? undefined
      : resolveBinding(target, imported, 'export', readModule, workspace, seen);
  };
  if (scope === 'local') {
    const imported = importedBinding(module, name);
    return imported === undefined
      ? undefined
      : throughModule(imported.specifier, imported.imported);
  }
  if (name === 'default') {
    const exported = defaultExport(module);
    if (typeof exported === 'string')
      return resolveBinding(
        module,
        exported,
        'local',
        readModule,
        workspace,
        seen,
      );
    return exported === undefined
      ? undefined
      : { expression: exported, module };
  }
  const reexported = reexportedBinding(module, name);
  if (reexported !== undefined)
    return reexported.specifier === undefined
      ? resolveBinding(
          module,
          reexported.local,
          'local',
          readModule,
          workspace,
          seen,
        )
      : throughModule(reexported.specifier, reexported.local);
  for (const statement of module.file.program.body) {
    if (!t.isExportAllDeclaration(statement) || statement.exportKind === 'type')
      continue;
    const resolved = throughModule(statement.source.value, name);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
};

const objectLiteral = (
  expression: Expression | null | undefined,
): ObjectLiteralExpression | undefined => {
  if (expression == null) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expression);
  return t.isObjectExpression(unwrapped) ? unwrapped : undefined;
};

const propertyAssignments = (
  properties: readonly ObjectLiteralElementLike[],
): ReadonlyMap<string, PropertyAssignment> | undefined => {
  const assignments = new Map<string, PropertyAssignment>();
  for (const property of properties) {
    if (
      !t.isObjectProperty(property) ||
      property.computed ||
      property.shorthand
    ) {
      return undefined;
    }
    const name = propertyName(property.key);
    if (name === undefined || assignments.has(name)) {
      return undefined;
    }
    assignments.set(name, property);
  }
  return assignments;
};

const exactCall = (
  expression: Expression | null | undefined,
  callee: readonly string[],
  argumentCount: number,
): CallExpression | undefined => {
  const call = callExpression(expression, callee);
  return call?.arguments.length === argumentCount ? call : undefined;
};

interface SharedSchemaObject {
  readonly assignments: ReadonlyMap<string, PropertyAssignment>;
  readonly identity: boolean;
}

const sharedSchemaObject = (
  declaration: VariableDeclaration | undefined,
  sharedSchemaName: string,
  protectedFields: readonly string[],
): SharedSchemaObject | undefined => {
  if (declaration?.init == null) {
    return undefined;
  }
  const initializer = unwrapExpression(declaration.init);
  if (t.isIdentifier(initializer) && initializer.name === sharedSchemaName) {
    return { assignments: new Map(), identity: true };
  }
  const struct = exactCall(initializer, ['Schema', 'Struct'], 1);
  const schemaObject = objectLiteral(struct?.arguments[0]);
  if (schemaObject === undefined) {
    return undefined;
  }
  const spreads = schemaObject.properties.filter(t.isSpreadElement);
  const assignments = propertyAssignments(
    schemaObject.properties.filter(property => !t.isSpreadElement(property)),
  );
  if (
    spreads.length !== 1 ||
    !spreads.every(spread =>
      isAccessPath(spread.argument, [sharedSchemaName, 'fields']),
    ) ||
    assignments === undefined ||
    protectedFields.some(field => assignments.has(field))
  ) {
    return undefined;
  }
  return { assignments, identity: false };
};

interface DirectCallChain {
  readonly base: CallExpression;
  readonly methods: readonly {
    readonly arguments: readonly Expression[];
    readonly name: string;
  }[];
}

const directCallChain = (
  expression: Expression | null | undefined,
): DirectCallChain | undefined => {
  if (expression == null) {
    return undefined;
  }
  let current = unwrapExpression(expression);
  const methods: {
    readonly arguments: readonly Expression[];
    readonly name: string;
  }[] = [];
  while (
    t.isCallExpression(current) &&
    t.isMemberExpression(current.callee) &&
    !current.callee.computed &&
    t.isIdentifier(current.callee.property) &&
    !t.isIdentifier(current.callee.object)
  ) {
    methods.unshift({
      arguments: current.arguments,
      name: current.callee.property.name,
    });
    current = unwrapExpression(current.callee.object);
  }
  if (!t.isCallExpression(current)) {
    return undefined;
  }
  return { base: current, methods };
};

const brandedStringSchemaIsExact = (
  declaration: VariableDeclaration | undefined,
  brand: string,
): boolean => {
  const initializer = declaration?.init;
  if (initializer == null) {
    return false;
  }
  const pipeCall = unwrapExpression(initializer);
  if (
    !t.isCallExpression(pipeCall) ||
    !t.isMemberExpression(pipeCall.callee) ||
    pipeCall.callee.computed ||
    !t.isIdentifier(pipeCall.callee.property, { name: 'pipe' }) ||
    !isAccessPath(pipeCall.callee.object, ['Schema', 'String']) ||
    pipeCall.arguments.length !== 1
  ) {
    return false;
  }
  const brandCall = exactCall(pipeCall.arguments[0], ['Schema', 'brand'], 1);
  return stringLiteral(brandCall?.arguments[0]) === brand;
};

const importedRuntimeNames = (
  statement: Node,
  expectedPackage: string,
): readonly string[] => {
  if (
    !t.isImportDeclaration(statement) ||
    statement.source.value !== expectedPackage ||
    statement.importKind === 'type'
  )
    return [];
  return statement.specifiers.flatMap(value =>
    t.isImportSpecifier(value) &&
    value.importKind !== 'type' &&
    t.isIdentifier(value.imported) &&
    value.imported.name === value.local.name
      ? [value.local.name]
      : [],
  );
};

const importsExactBindings = (
  sourceFile: SourceFile,
  expectedPackage: string,
  expectedBindings: readonly string[],
): boolean => {
  const names = new Set(
    sourceFile.program.body.flatMap(statement =>
      importedRuntimeNames(statement, expectedPackage),
    ),
  );
  return expectedBindings.every(name => names.has(name));
};

const baselineBindings = [
  'MicroVerticalBuildMarkerSchema',
  'MicroVerticalReadinessSchema',
  'createMicroVerticalOperationContext',
] as const;

const importsSharedBaselinePrimitives = (
  sourceFile: SourceFile,
  expectedPackage: string,
): boolean =>
  importsExactBindings(sourceFile, expectedPackage, baselineBindings);

const singleAddedArgument = (
  expression: Expression | null | undefined,
  factory: readonly string[],
  names: readonly string[],
): Expression | undefined => {
  const chain = directCallChain(expression);
  if (chain === undefined || !isAccessPath(chain.base.callee, factory)) {
    return undefined;
  }
  const [method] = chain.methods;
  if (
    chain.base.arguments.length !== 1 ||
    !names.includes(stringLiteral(chain.base.arguments[0]) ?? '') ||
    chain.methods.length !== 1 ||
    method?.name !== 'add' ||
    method.arguments.length !== 1
  ) {
    return undefined;
  }
  return method.arguments[0];
};

const foundationIsExact = (
  declaration: VariableDeclaration | undefined,
  stem: string,
  readinessSchemaName: string,
): boolean => {
  const group = singleAddedArgument(
    declaration?.init,
    ['HttpApi', 'make'],
    [
      `${pascalCaseStem(stem)}FoundationApi`,
      `${pascalCaseStem(stem)}ApiFoundation`,
    ],
  );
  const endpointExpression = singleAddedArgument(
    group,
    ['HttpApiGroup', 'make'],
    ['foundation'],
  );
  const endpoint = exactCall(endpointExpression, ['HttpApiEndpoint', 'get'], 3);
  const endpointOptions = objectLiteral(endpoint?.arguments[2]);
  const endpointProperties =
    endpointOptions === undefined
      ? undefined
      : propertyAssignments(endpointOptions.properties);
  return (
    endpoint !== undefined &&
    stringLiteral(endpoint.arguments[0]) === 'readiness' &&
    stringLiteral(endpoint.arguments[1]) === `/${stem}/readiness` &&
    endpointProperties?.size === 1 &&
    identifierName(endpointProperties.get('success')?.value) ===
      readinessSchemaName
  );
};

const rootComposesFoundation = (
  sourceFile: SourceFile,
  declaration: VariableDeclaration | undefined,
  stem: string,
  foundationName: string,
): boolean => {
  const chain = directCallChain(declaration?.init);
  const first = chain?.methods[0];
  return (
    chain !== undefined &&
    isAccessPath(chain.base.callee, ['HttpApi', 'make']) &&
    chain.base.arguments.length === 1 &&
    stringLiteral(chain.base.arguments[0]) === `${pascalCaseStem(stem)}Api` &&
    chain.methods.length > 0 &&
    chain.methods.every(
      (method, index) =>
        method.arguments.length === 1 &&
        (method.name === 'add' ||
          method.name === 'addHttpApi' ||
          (index === chain.methods.length - 1 &&
            method.name === 'pipe' &&
            identifierName(method.arguments[0]) === 'identity' &&
            importsExactBindings(sourceFile, 'effect', ['identity']))),
    ) &&
    first?.name === 'addHttpApi' &&
    identifierName(first.arguments[0]) === foundationName
  );
};

/**
 * Effect combinators that return the same api/group without adding endpoints,
 * from `effect/unstable/httpapi`. `prefix` is the one exception that rewrites
 * the routes already collected, so the traversal applies it rather than
 * ignoring it. Anything outside this set is still rejected.
 */
const nonEndpointCombinators: Readonly<
  Record<'api' | 'group', Readonly<Record<string, number>>>
> = {
  api: { annotate: 2, annotateMerge: 1, middleware: 1 },
  group: {
    annotate: 2,
    annotateEndpoints: 2,
    annotateEndpointsMerge: 1,
    annotateMerge: 1,
    middleware: 1,
  },
};

interface ReachableEndpoint {
  readonly group: string;
  readonly name: string;
  readonly method: string;
  readonly routePath: string;
}

/** Read only endpoint declarations connected to the exported API, never decoy calls elsewhere. */
const reachableEndpoints = (
  rootModule: ConsumerModule,
  declaration: VariableDeclaration | undefined,
): readonly ReachableEndpoint[] | undefined => {
  const readModule = createModuleReader(rootModule);
  const workspace = containingWorkspace(rootModule.path);
  const active = new Set<Node>();
  const endpoints: ReachableEndpoint[] = [];
  const identities = new Set<string>();
  const verbs: Readonly<Record<string, string>> = {
    get: 'GET',
    post: 'POST',
    put: 'PUT',
    patch: 'PATCH',
    del: 'DELETE',
    delete: 'DELETE',
    head: 'HEAD',
    options: 'OPTIONS',
  };
  let visits = 0;
  const visit = (
    expression: Expression | null | undefined,
    module: ConsumerModule,
    kind: 'api' | 'group' | 'endpoint',
    group = '',
  ): boolean => {
    if (!expression) return false;
    const node = unwrapExpression(expression);
    if (active.has(node) || active.size >= 128 || ++visits > 2048) return false;
    active.add(node);
    try {
      if (t.isIdentifier(node)) {
        const resolved = resolveBinding(
          module,
          node.name,
          'local',
          readModule,
          workspace,
          new Set(),
        );
        return (
          resolved !== undefined &&
          visit(resolved.expression, resolved.module, kind, group)
        );
      }
      if (kind === 'endpoint') {
        if (
          !t.isCallExpression(node) ||
          node.arguments.length < 2 ||
          node.arguments.length > 3
        )
          return false;
        const callee = accessPath(node.callee);
        const method =
          callee?.length === 2 && callee[0] === 'HttpApiEndpoint'
            ? verbs[callee[1]]
            : undefined;
        const name = stringLiteral(node.arguments[0]);
        const routePath = stringLiteral(node.arguments[1]);
        if (!method || !name || !routePath) return false;
        const identity = `${group}:${name}`;
        if (identities.has(identity)) return false;
        identities.add(identity);
        endpoints.push({ group, name, method, routePath });
        return true;
      }
      const chain = directCallChain(node);
      if (
        !chain ||
        !isAccessPath(chain.base.callee, [
          kind === 'api' ? 'HttpApi' : 'HttpApiGroup',
          'make',
        ]) ||
        chain.base.arguments.length !== 1
      )
        return false;
      const name = stringLiteral(chain.base.arguments[0]);
      if (!name) return false;
      // Everything this chain contributes, so `prefix` can rewrite exactly the
      // routes Effect would rewrite: those already added when it is applied.
      const chainStart = endpoints.length;
      const combinators = nonEndpointCombinators[kind];
      return chain.methods.every(method => {
        if (method.name === 'prefix') {
          const prefix = stringLiteral(method.arguments[0]);
          if (method.arguments.length !== 1 || !prefix?.startsWith('/'))
            return false;
          for (let index = chainStart; index < endpoints.length; index += 1) {
            const endpoint = endpoints[index]!;
            endpoints[index] = {
              ...endpoint,
              routePath: `${prefix}${endpoint.routePath}`,
            };
          }
          return true;
        }
        const combinatorArity = combinators[method.name];
        if (combinatorArity !== undefined)
          return method.arguments.length === combinatorArity;
        if (method.arguments.length !== 1) return false;
        if (method.name === 'pipe')
          return (
            identifierName(method.arguments[0]) === 'identity' &&
            importsExactBindings(module.file, 'effect', ['identity'])
          );
        if (method.name === 'add')
          return visit(
            method.arguments[0],
            module,
            kind === 'api' ? 'group' : 'endpoint',
            kind === 'group' ? name : '',
          );
        return (
          kind === 'api' &&
          method.name === 'addHttpApi' &&
          visit(method.arguments[0], module, 'api')
        );
      });
    } finally {
      active.delete(node);
    }
  };
  return visit(declaration?.init, rootModule, 'api') ? endpoints : undefined;
};

const operationContextFields = (property: PropertyAssignment) => {
  const constructorCall = exactCall(
    property.value,
    ['createMicroVerticalOperationContext'],
    1,
  );
  const input = objectLiteral(constructorCall?.arguments[0]);
  return input === undefined
    ? undefined
    : propertyAssignments(input.properties);
};

const operationContextIdentity = (
  property: PropertyAssignment,
):
  | {
      readonly method: string;
      readonly operationId: string;
      readonly routePath: string;
    }
  | undefined => {
  const fields = operationContextFields(property);
  const method = stringLiteral(fields?.get('method')?.value);
  const operationId = stringLiteral(fields?.get('operationId')?.value);
  const routePath = stringLiteral(fields?.get('routePath')?.value);
  if (
    fields?.size !== 3 ||
    method === undefined ||
    operationId === undefined ||
    routePath === undefined
  ) {
    return undefined;
  }
  return { method, operationId, routePath };
};

const operationContextIsConstructed = (
  property: PropertyAssignment,
  stem: string,
  propertyKey: string,
  operationPaths: Readonly<Record<string, string>>,
  endpoints: readonly ReachableEndpoint[],
): boolean => {
  const identity = operationContextIdentity(property);
  if (identity === undefined) {
    return false;
  }
  const { method, operationId, routePath } = identity;
  if (
    !/^[A-Z]+$/u.test(method) ||
    !/^\/(?!.*(?:^|\/)\.\.?\/)[^\s?#]*$/u.test(routePath)
  ) {
    return false;
  }
  const apiName = `${pascalCaseStem(stem)}Api`;
  if (
    propertyKey === 'readiness' &&
    (method !== 'GET' || routePath !== `/${stem}/readiness`)
  )
    return false;
  return (
    operationId === `${apiName}:${routePath}` ||
    operationPaths[operationId] === routePath ||
    endpoints.some(
      endpoint =>
        endpoint.name === propertyKey &&
        endpoint.method === method &&
        endpoint.routePath === routePath &&
        (operationId === `${apiName}:${endpoint.group}:${propertyKey}` ||
          (propertyKey === 'readiness' &&
            operationId === `${apiName}:${camelCaseStem(stem)}:readiness`)),
    )
  );
};

const operationMapIsConnected = (
  declaration: VariableDeclaration | undefined,
  stem: string,
  operationPaths: Readonly<Record<string, string>>,
  endpoints: readonly ReachableEndpoint[],
): boolean => {
  const map = objectLiteral(declaration?.init);
  const properties =
    map === undefined ? undefined : propertyAssignments(map.properties);
  return (
    properties !== undefined &&
    properties.has('readiness') &&
    [...properties].every(([key, property]) =>
      operationContextIsConstructed(
        property,
        stem,
        key,
        operationPaths,
        endpoints,
      ),
    )
  );
};

const constAssertionObject = (
  declaration: VariableDeclaration | undefined,
): ObjectLiteralExpression | undefined => {
  const initializer = declaration?.init;
  if (
    initializer == null ||
    !t.isTSAsExpression(initializer) ||
    !t.isTSTypeReference(initializer.typeAnnotation) ||
    !t.isIdentifier(initializer.typeAnnotation.typeName, { name: 'const' })
  ) {
    return undefined;
  }
  return objectLiteral(initializer.expression);
};

const metadataIsExact = (
  declaration: VariableDeclaration | undefined,
  expectation: MicroVerticalApiBaselineExpectation,
  endpoints: readonly ReachableEndpoint[],
): boolean => {
  const object = constAssertionObject(declaration);
  const fields =
    object === undefined ? undefined : propertyAssignments(object.properties);
  const expectedFields = [
    ['apiPrefix', expectation.apiPrefix],
    ['basePath', expectation.basePath],
    ['ownerId', expectation.ownerId],
    ['readinessPath', expectation.readinessPath],
  ] as const;
  if (
    !fields ||
    !expectedFields.every(
      ([field, value]) => stringLiteral(fields.get(field)?.value) === value,
    )
  )
    return false;
  const common = new Set<string>(expectedFields.map(([field]) => field));
  return [...fields].every(([field, property]) => {
    if (common.has(field)) return true;
    const value = stringLiteral(property.value);
    if (value === undefined) return false;
    const explicit = expectation.additionalPaths[field];
    if (explicit !== undefined) return value === explicit;
    if (
      !value.startsWith(`${expectation.apiPrefix}/`) ||
      /[\s?#]/u.test(value) ||
      value.split('/').some(segment => segment === '.' || segment === '..')
    )
      return false;
    return endpoints.some(endpoint => {
      const route = `${expectation.apiPrefix}${endpoint.routePath}`;
      return route === value || route.startsWith(`${value}/`);
    });
  });
};

const markerSchemaIsShared = (
  sourceFile: SourceFile,
  declaration: VariableDeclaration | undefined,
): boolean => {
  const schema = sharedSchemaObject(
    declaration,
    'MicroVerticalBuildMarkerSchema',
    [
      'build',
      'buildMarker',
      'deployProfile',
      'packageName',
      'sourceRevision',
      'surface',
      'version',
    ],
  );
  if (schema === undefined || schema.identity) {
    return schema?.identity === true;
  }
  const brandedField = (property: PropertyAssignment, brand: string): boolean =>
    identifierName(property.value) === `${brand}Schema` &&
    brandedStringSchemaIsExact(localConst(sourceFile, `${brand}Schema`), brand);
  const validators = new Map<string, (property: PropertyAssignment) => boolean>(
    [
      ['appId', property => brandedField(property, 'AppId')],
      ['unitId', property => brandedField(property, 'UnitId')],
      [
        'kind',
        property =>
          stringLiteral(
            exactCall(property.value, ['Schema', 'Literal'], 1)?.arguments[0],
          ) === 'microvertical-delivery-unit',
      ],
      [
        'schemaVersion',
        property =>
          numericLiteral(
            exactCall(property.value, ['Schema', 'Literal'], 1)?.arguments[0],
          ) === 1,
      ],
    ],
  );
  return [...schema.assignments].every(
    ([field, property]) => validators.get(field)?.(property) === true,
  );
};

const readinessSchemaIsShared = (
  declaration: VariableDeclaration | undefined,
  markerSchemaName: string,
  ownerMarkerIsIdentity: boolean,
): boolean => {
  const schema = sharedSchemaObject(
    declaration,
    'MicroVerticalReadinessSchema',
    ['checks', 'status', 'versionSkew'],
  );
  return (
    schema !== undefined &&
    ((schema.identity && ownerMarkerIsIdentity) ||
      (schema.assignments.size === 1 &&
        identifierName(schema.assignments.get('marker')?.value) ===
          markerSchemaName))
  );
};

const declarationIsIdentifier = (
  declaration: VariableDeclaration | undefined,
  identifier: string,
): boolean =>
  declaration?.init != null &&
  identifierName(unwrapExpression(declaration.init)) === identifier;

const validateParsedContract = (
  module: ConsumerModule,
  stem: string,
  expectation: MicroVerticalApiBaselineExpectation,
): string | undefined => {
  const sourceFile = module.file;
  const exportStem = camelCaseStem(stem);
  const foundationName = `${exportStem}FoundationApi`;
  const markerSchemaName = `${exportStem}MarkerSchema`;
  const readinessSchemaName = `${exportStem}ReadinessSchema`;
  const markerDeclaration = exportedConst(sourceFile, markerSchemaName);
  if (
    !importsExactBindings(sourceFile, expectation.effectClientPackage, [
      'HttpApi',
      'HttpApiEndpoint',
      'HttpApiGroup',
      'Schema',
    ])
  ) {
    return 'MicroVertical root contract must import exact Effect API primitives from the framework client package';
  }
  if (
    !importsSharedBaselinePrimitives(sourceFile, expectation.baselinePackage)
  ) {
    return 'MicroVertical root contract must import exact baseline primitives from the framework baseline package';
  }
  if (!markerSchemaIsShared(sourceFile, markerDeclaration)) {
    return 'MicroVertical root contract must consume the shared build marker schema without overriding shared fields';
  }
  if (
    !readinessSchemaIsShared(
      exportedConst(sourceFile, readinessSchemaName),
      markerSchemaName,
      declarationIsIdentifier(
        markerDeclaration,
        'MicroVerticalBuildMarkerSchema',
      ),
    )
  ) {
    return 'MicroVertical readiness schema must consume the shared readiness schema without overriding shared fields';
  }
  if (
    !foundationIsExact(
      exportedConst(sourceFile, foundationName),
      stem,
      readinessSchemaName,
    )
  ) {
    return 'MicroVertical readiness foundation API must directly compose its exact readiness endpoint and foundation identity';
  }
  if (
    !rootComposesFoundation(
      sourceFile,
      exportedConst(sourceFile, `${exportStem}Api`),
      stem,
      foundationName,
    )
  ) {
    return 'MicroVertical root API must explicitly compose its readiness foundation API';
  }
  const endpoints = reachableEndpoints(
    module,
    exportedConst(sourceFile, `${exportStem}Api`),
  );
  if (!endpoints)
    return 'MicroVertical root API must compose bounded native endpoint declarations without ambiguous identities';
  if (
    !operationMapIsConnected(
      exportedConst(sourceFile, `${exportStem}OperationContexts`),
      stem,
      expectation.operationPaths ?? {},
      endpoints,
    )
  ) {
    return 'MicroVertical operation map must construct every operation with the shared context constructor';
  }
  if (
    !metadataIsExact(
      exportedConst(sourceFile, `${exportStem}ApiContract`),
      expectation,
      endpoints,
    )
  ) {
    return 'MicroVertical root contract must keep exact owner and API path metadata without forbidden fields';
  }
  return undefined;
};

export interface MicroVerticalApiBaselineExpectation {
  /** Optional override for operation IDs outside reachable endpoint naming conventions. */
  readonly operationPaths?: Readonly<Record<string, string>>;
  readonly additionalPaths: Readonly<Record<string, string>>;
  readonly apiPrefix: string;
  readonly basePath: string;
  readonly effectClientPackage: string;
  readonly ownerId: string;
  readonly readinessPath: string;
  readonly baselinePackage: '@modern-js/bff-effect/microvertical-api';
  readonly baselinePackageDirectory: string;
}

export interface MicroVerticalTopologyEntry {
  readonly api?: { readonly readiness?: { readonly endpoint?: string } };
  readonly id: string;
  readonly path?: string;
}

export const configuredMicroVerticalApiStem = (
  verticalPath: string,
  verticals: readonly MicroVerticalTopologyEntry[],
): string | undefined => {
  const topologyVertical = verticals.find(
    vertical => (vertical.path ?? `verticals/${vertical.id}`) === verticalPath,
  );
  const endpoint = topologyVertical?.api?.readiness?.endpoint;
  return endpoint?.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/readiness$/u)?.[1];
};

export const microVerticalApiBaselineViolation = (
  stem: string,
  filePath: string,
  expectation: MicroVerticalApiBaselineExpectation,
): string | undefined => {
  try {
    const realPath = fs.realpathSync(filePath);
    const sourceFile = parseConsumer(realPath);
    if (!baselinePublicIdentityIsExact(filePath, expectation))
      return 'MicroVertical baseline imports must resolve the exact framework owner public export and schema identity';
    return validateParsedContract(
      {
        file: sourceFile,
        path: realPath,
        boundary: sourceBoundary(realPath, containingWorkspace(realPath)),
      },
      stem,
      expectation,
    );
  } catch (error) {
    if (error instanceof SourceSyntaxError)
      return `MicroVertical root contract must be valid TypeScript syntax (${error.message})`;
    throw error;
  }
};
