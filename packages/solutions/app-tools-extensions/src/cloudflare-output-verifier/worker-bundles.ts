import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse } from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import {
  CLOUDFLARE_WORKER_BUNDLE_DIRECTORY,
  CLOUDFLARE_WORKER_NODE_BUILTINS,
} from '../cloudflare-output-contract';
import type { CloudflareOutputVerifierIssue, JsonObject } from './issues';
import { addIssue } from './issues';

interface WorkerBundleReference {
  dispatcherExport?: string;
  kind: 'effect-bff' | 'route';
  reference: string;
}

interface ResolvedWorkerBundleReference extends WorkerBundleReference {
  path: string;
}

const getReferencedRouteWorkers = (manifest: JsonObject) =>
  Array.isArray(manifest?.routeSpec?.routes)
    ? manifest.routeSpec.routes
        .map((route: any) =>
          typeof route?.worker === 'string' && route.worker.length > 0
            ? route.worker
            : undefined,
        )
        .filter(
          (worker: unknown): worker is string => typeof worker === 'string',
        )
    : [];

export const getEffectBffWorker = (manifest: JsonObject) =>
  manifest?.bff?.runtimeFramework === 'effect' &&
  typeof manifest.bff.worker === 'string'
    ? manifest.bff.worker
    : undefined;

export const getWorkerBundleReferences = (
  manifest: JsonObject,
): WorkerBundleReference[] => {
  const effectBffWorker = getEffectBffWorker(manifest);
  return [
    ...(effectBffWorker
      ? [
          {
            dispatcherExport:
              typeof manifest.bff?.dispatcherExport === 'string'
                ? manifest.bff.dispatcherExport
                : undefined,
            kind: 'effect-bff' as const,
            reference: effectBffWorker,
          },
        ]
      : []),
    ...getReferencedRouteWorkers(manifest).map((reference: string) => ({
      kind: 'route' as const,
      reference,
    })),
  ];
};

export const resolveWorkerBundleReference = (
  issues: CloudflareOutputVerifierIssue[],
  outputDirectory: string,
  reference: WorkerBundleReference,
  manifestPath: string,
): ResolvedWorkerBundleReference | null => {
  const workerRoot = path.resolve(
    outputDirectory,
    CLOUDFLARE_WORKER_BUNDLE_DIRECTORY,
  );
  const workerPath = path.resolve(outputDirectory, reference.reference);
  const relativeToWorkerRoot = path.relative(workerRoot, workerPath);

  if (
    path.isAbsolute(reference.reference) ||
    relativeToWorkerRoot.startsWith('..') ||
    path.isAbsolute(relativeToWorkerRoot)
  ) {
    addIssue(issues, {
      code: 'invalid-manifest',
      message:
        'Cloudflare output manifest worker bundle references must stay under worker/.',
      path: manifestPath,
    });
    return null;
  }

  return {
    ...reference,
    path: workerPath,
  };
};

export const missingWorkerBundleMessage = (reference: WorkerBundleReference) =>
  reference.kind === 'effect-bff'
    ? 'Cloudflare Effect BFF manifest points to a missing worker bundle.'
    : 'Cloudflare route worker manifest points to a missing worker bundle.';

interface AstNode {
  type: string;
  [key: string]: unknown;
}

interface WorkerModuleAnalysis {
  exports: Set<string>;
  imports: Set<string>;
  unsafeCommonJsLoaderUsage: boolean;
  unsafeDynamicImport: boolean;
}

interface WorkerBundleVerificationContract {
  providedPackages: ReadonlySet<string>;
  workerRoot: string;
}

const isAstNode = (value: unknown): value is AstNode =>
  value !== null &&
  typeof value === 'object' &&
  'type' in value &&
  typeof value.type === 'string';

const getNodeName = (node: unknown) => {
  if (!isAstNode(node)) {
    return undefined;
  }
  return node.type === 'Identifier' && typeof node.name === 'string'
    ? node.name
    : node.type === 'StringLiteral' && typeof node.value === 'string'
      ? node.value
      : undefined;
};

const getStringLiteralValue = (node: unknown) =>
  isAstNode(node) &&
  node.type === 'StringLiteral' &&
  typeof node.value === 'string'
    ? node.value
    : undefined;

const collectBindingNames = (node: unknown, names: Set<string>) => {
  if (!isAstNode(node)) {
    return;
  }
  const name = getNodeName(node);
  if (name) {
    names.add(name);
    return;
  }
  if (node.type === 'ObjectPattern' && Array.isArray(node.properties)) {
    for (const property of node.properties) {
      if (isAstNode(property)) {
        collectBindingNames(
          property.type === 'RestElement' ? property.argument : property.value,
          names,
        );
      }
    }
  } else if (node.type === 'ArrayPattern' && Array.isArray(node.elements)) {
    for (const element of node.elements) {
      collectBindingNames(element, names);
    }
  } else if (node.type === 'AssignmentPattern' || node.type === 'RestElement') {
    collectBindingNames(
      node.type === 'AssignmentPattern' ? node.left : node.argument,
      names,
    );
  }
};

const getMemberPropertyName = (node: AstNode) => {
  if (node.type !== 'MemberExpression') {
    return undefined;
  }
  return node.computed === true
    ? getStringLiteralValue(node.property)
    : getNodeName(node.property);
};

const isAmbientModuleRequire = (node: unknown, modulePath: NodePath) =>
  isAstNode(node) &&
  node.type === 'MemberExpression' &&
  isAstNode(node.object) &&
  node.object.type === 'Identifier' &&
  node.object.name === 'module' &&
  modulePath.scope.getBinding('module') === undefined &&
  getMemberPropertyName(node) === 'require';

const isModuleExports = (node: unknown) =>
  isAstNode(node) &&
  node.type === 'MemberExpression' &&
  isAstNode(node.object) &&
  node.object.type === 'Identifier' &&
  node.object.name === 'module' &&
  getMemberPropertyName(node) === 'exports';

const collectCommonJsExports = (statement: AstNode, exports: Set<string>) => {
  if (
    statement.type !== 'ExpressionStatement' ||
    !isAstNode(statement.expression) ||
    statement.expression.type !== 'AssignmentExpression'
  ) {
    return;
  }
  const { left, right } = statement.expression;
  if (
    isAstNode(left) &&
    left.type === 'MemberExpression' &&
    ((isAstNode(left.object) &&
      left.object.type === 'Identifier' &&
      left.object.name === 'exports') ||
      isModuleExports(left.object))
  ) {
    const exportName = getMemberPropertyName(left);
    if (exportName) {
      exports.add(exportName);
    }
    return;
  }
  if (
    isModuleExports(left) &&
    isAstNode(right) &&
    right.type === 'ObjectExpression' &&
    Array.isArray(right.properties)
  ) {
    for (const property of right.properties) {
      if (isAstNode(property)) {
        const exportName = getNodeName(property.key);
        if (exportName) {
          exports.add(exportName);
        }
      }
    }
  }
};

const collectEsmExports = (statement: AstNode, exports: Set<string>) => {
  if (statement.type === 'ExportDefaultDeclaration') {
    exports.add('default');
    return;
  }
  if (statement.type !== 'ExportNamedDeclaration') {
    return;
  }
  if (isAstNode(statement.declaration)) {
    const declaration = statement.declaration;
    const declarationName = getNodeName(declaration.id);
    if (declarationName) {
      exports.add(declarationName);
    }
    if (
      declaration.type === 'VariableDeclaration' &&
      Array.isArray(declaration.declarations)
    ) {
      for (const declarator of declaration.declarations) {
        if (isAstNode(declarator)) {
          collectBindingNames(declarator.id, exports);
        }
      }
    }
  }
  if (Array.isArray(statement.specifiers)) {
    for (const specifier of statement.specifiers) {
      if (isAstNode(specifier)) {
        const exportName = getNodeName(specifier.exported);
        if (exportName) {
          exports.add(exportName);
        }
      }
    }
  }
};

const getStaticImport = (modulePath: NodePath) => {
  const node = modulePath.node as unknown as AstNode;
  if (
    (node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration') &&
    isAstNode(node.source)
  ) {
    return getStringLiteralValue(node.source);
  }
  if (node.type === 'ImportExpression' && isAstNode(node.source)) {
    return getStringLiteralValue(node.source);
  }
  if (
    node.type === 'CallExpression' &&
    Array.isArray(node.arguments) &&
    node.arguments.length === 1 &&
    isAstNode(node.callee) &&
    ((node.callee.type === 'Identifier' &&
      node.callee.name === 'require' &&
      modulePath.scope.getBinding('require') === undefined) ||
      isAmbientModuleRequire(node.callee, modulePath) ||
      node.callee.type === 'Import')
  ) {
    return getStringLiteralValue(node.arguments[0]);
  }
  return undefined;
};

const isAmbientLoaderWrite = (modulePath: NodePath) => {
  let targetPath: NodePath = modulePath;

  while (true) {
    const parentPath: NodePath | null = targetPath.parentPath;
    if (parentPath === null) {
      return false;
    }
    if (parentPath.isAssignmentExpression()) {
      return targetPath.key === 'left';
    }
    if (parentPath.isUpdateExpression()) {
      return targetPath.key === 'argument';
    }
    if (parentPath.isForInStatement() || parentPath.isForOfStatement()) {
      return targetPath.key === 'left';
    }
    if (parentPath.isObjectProperty()) {
      if (targetPath.key !== 'value') {
        return false;
      }
      targetPath = parentPath;
      continue;
    }
    if (
      parentPath.isObjectPattern() ||
      parentPath.isArrayPattern() ||
      parentPath.isRestElement() ||
      parentPath.isAssignmentPattern()
    ) {
      targetPath = parentPath;
      continue;
    }
    return false;
  }
};

const analyzeWorkerModule = (source: string): WorkerModuleAnalysis => {
  const ast = parse(source, {
    sourceType: 'unambiguous',
  });
  const exports = new Set<string>();
  const imports = new Set<string>();
  let unsafeCommonJsLoaderUsage = false;
  let unsafeDynamicImport = false;
  for (const statement of ast.program.body) {
    collectEsmExports(statement as AstNode, exports);
    collectCommonJsExports(statement as AstNode, exports);
  }
  traverse(ast, {
    enter(modulePath: NodePath) {
      const node = modulePath.node as unknown as AstNode;
      if (
        (node.type === 'ImportExpression' ||
          (node.type === 'CallExpression' &&
            isAstNode(node.callee) &&
            node.callee.type === 'Import')) &&
        getStaticImport(modulePath) === undefined
      ) {
        unsafeDynamicImport = true;
      }
      if (
        modulePath.isReferencedIdentifier({ name: 'require' }) &&
        modulePath.scope.getBinding('require') === undefined
      ) {
        const parentPath = modulePath.parentPath;
        const isStaticRequireCall =
          parentPath?.isCallExpression() &&
          modulePath.key === 'callee' &&
          getStaticImport(parentPath) !== undefined;
        const isAvailabilityCheck = parentPath?.isUnaryExpression({
          operator: 'typeof',
        });
        if (!isStaticRequireCall && !isAvailabilityCheck) {
          unsafeCommonJsLoaderUsage = true;
        }
      }
      if (
        node.type === 'Identifier' &&
        isAmbientLoaderWrite(modulePath) &&
        (node.name === 'require' || node.name === 'module') &&
        modulePath.scope.getBinding(node.name) === undefined
      ) {
        unsafeCommonJsLoaderUsage = true;
      }
      if (
        modulePath.isReferencedIdentifier({ name: 'module' }) &&
        modulePath.scope.getBinding('module') === undefined
      ) {
        const parentPath = modulePath.parentPath;
        const isExportsAccess =
          parentPath !== null && isModuleExports(parentPath.node);
        const isStaticModuleRequireCall =
          parentPath !== null &&
          isAmbientModuleRequire(parentPath.node, parentPath) &&
          parentPath.parentPath?.isCallExpression() === true &&
          parentPath.key === 'callee' &&
          getStaticImport(parentPath.parentPath) !== undefined;
        if (!isExportsAccess && !isStaticModuleRequireCall) {
          unsafeCommonJsLoaderUsage = true;
        }
      }
      if (isAmbientModuleRequire(node, modulePath)) {
        const parentPath = modulePath.parentPath;
        const isStaticRequireCall =
          parentPath?.isCallExpression() &&
          modulePath.key === 'callee' &&
          getStaticImport(parentPath) !== undefined;
        if (!isStaticRequireCall) {
          unsafeCommonJsLoaderUsage = true;
        }
      }
      const specifier = getStaticImport(modulePath);
      if (specifier !== undefined) {
        imports.add(specifier);
      }
    },
  });
  return {
    exports,
    imports,
    unsafeCommonJsLoaderUsage,
    unsafeDynamicImport,
  };
};

const getPackageName = (specifier: string) =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];

const CLOUDFLARE_WORKER_NODE_BUILTIN_SPECIFIERS = new Set(
  CLOUDFLARE_WORKER_NODE_BUILTINS.map(builtin => `node:${builtin}`),
);

const isInsideDirectory = (directory: string, filePath: string) => {
  const relative = path.relative(directory, filePath);
  return (
    relative.length === 0 ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

const resolveWorkerModule = async (importer: string, specifier: string) => {
  const unresolvedPath = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    unresolvedPath,
    `${unresolvedPath}.js`,
    `${unresolvedPath}.mjs`,
    `${unresolvedPath}.cjs`,
    path.join(unresolvedPath, 'index.js'),
    path.join(unresolvedPath, 'index.mjs'),
    path.join(unresolvedPath, 'index.cjs'),
  ];
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isFile()) {
        return await fs.realpath(candidate);
      }
    } catch {
      // Try the next valid Worker module spelling.
    }
  }
  return undefined;
};

const verifyWorkerModuleClosure = async (
  issues: CloudflareOutputVerifierIssue[],
  entryPath: string,
  entrySource: string,
  contract: WorkerBundleVerificationContract,
) => {
  const visited = new Set<string>();
  let entryAnalysis: WorkerModuleAnalysis | undefined;
  const [realWorkerRoot, realEntryPath] = await Promise.all([
    fs.realpath(contract.workerRoot),
    fs.realpath(entryPath),
  ]);

  if (!isInsideDirectory(realWorkerRoot, realEntryPath)) {
    addIssue(issues, {
      code: 'invalid-worker-bundle',
      message:
        'Cloudflare worker bundles must not resolve outside the staged worker directory.',
      path: entryPath,
    });
    return undefined;
  }

  const visitModule = async (
    modulePath: string,
    source?: string,
    isEntry = false,
  ) => {
    if (visited.has(modulePath)) {
      return;
    }
    visited.add(modulePath);
    let analysis: WorkerModuleAnalysis;
    try {
      analysis = analyzeWorkerModule(
        source ?? (await fs.readFile(modulePath, 'utf-8')),
      );
    } catch (error) {
      addIssue(issues, {
        code: 'invalid-worker-bundle',
        message: `Cloudflare worker bundle module could not be parsed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        path: modulePath,
      });
      return;
    }
    if (isEntry) {
      entryAnalysis = analysis;
    }

    if (analysis.unsafeCommonJsLoaderUsage) {
      addIssue(issues, {
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
        path: modulePath,
      });
    }
    if (analysis.unsafeDynamicImport) {
      addIssue(issues, {
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must not contain non-static dynamic module imports.',
        path: modulePath,
      });
    }

    for (const specifier of analysis.imports) {
      if (specifier.length === 0) {
        addIssue(issues, {
          code: 'invalid-worker-bundle',
          message:
            'Cloudflare worker bundle module specifiers must not be empty.',
          path: modulePath,
        });
        continue;
      }
      if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) {
        if (CLOUDFLARE_WORKER_NODE_BUILTIN_SPECIFIERS.has(specifier)) {
          continue;
        }
        if (specifier.startsWith('node:')) {
          addIssue(issues, {
            code: 'invalid-worker-bundle',
            message: `Cloudflare worker bundle import "${specifier}" is not a supported Worker node: builtin.`,
            path: modulePath,
          });
          continue;
        }
        if (!contract.providedPackages.has(getPackageName(specifier))) {
          addIssue(issues, {
            code: 'invalid-worker-bundle',
            message: `Cloudflare worker bundle import "${specifier}" is not provided by worker/package.json dependencies.`,
            path: modulePath,
          });
        }
        continue;
      }
      const resolved = await resolveWorkerModule(modulePath, specifier);
      if (resolved && !isInsideDirectory(realWorkerRoot, resolved)) {
        addIssue(issues, {
          code: 'invalid-worker-bundle',
          message:
            'Cloudflare worker bundles must not resolve outside the staged worker directory.',
          path: modulePath,
        });
        continue;
      }
      if (!resolved) {
        addIssue(issues, {
          code: 'invalid-worker-bundle',
          message: `Cloudflare worker bundle import "${specifier}" does not resolve inside worker/.`,
          path: modulePath,
        });
        continue;
      }
      await visitModule(resolved);
    }
  };

  await visitModule(realEntryPath, entrySource, true);
  return entryAnalysis;
};

export const verifyWorkerBundleReferences = async (
  issues: CloudflareOutputVerifierIssue[],
  worker: ResolvedWorkerBundleReference,
  source: string,
  contract: WorkerBundleVerificationContract,
) => {
  const entryAnalysis = await verifyWorkerModuleClosure(
    issues,
    worker.path,
    source,
    contract,
  );
  if (
    worker.kind === 'effect-bff' &&
    typeof worker.dispatcherExport === 'string' &&
    !entryAnalysis?.exports.has(worker.dispatcherExport)
  ) {
    addIssue(issues, {
      code: 'invalid-worker-bundle',
      message:
        'Cloudflare Effect BFF worker bundle must expose its manifest dispatcherExport.',
      path: worker.path,
    });
  }
};

export const verifyWorkerImport = async (
  issues: CloudflareOutputVerifierIssue[],
  entryPath: string,
  expectedManifest?: JsonObject,
) => {
  try {
    const workerModule = await import(
      `${pathToFileURL(entryPath).href}?t=${Date.now()}`
    );
    const worker = workerModule.default;

    if (!worker || typeof worker.fetch !== 'function') {
      addIssue(issues, {
        code: 'worker-import-failed',
        message:
          'Cloudflare server entry must default-export a Worker with fetch.',
        path: entryPath,
      });
    }
    if (
      expectedManifest !== undefined &&
      !isDeepStrictEqual(workerModule.modernWorkerManifest, expectedManifest)
    ) {
      addIssue(issues, {
        code: 'worker-import-failed',
        message:
          'Cloudflare server entry runtime manifest must exactly match modern-worker-manifest.json.',
        path: entryPath,
      });
    }
  } catch (error) {
    addIssue(issues, {
      code: 'worker-import-failed',
      message: `Cloudflare server entry could not be imported: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path: entryPath,
    });
  }
};
