// Consumer: renderer packed-consumer and final release acceptance runners.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, traverse } from '@babel/core';
import { parseDocument } from 'yaml';
import { repoRoot } from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/constants.mjs';
import {
  inspectNpmTarball,
  readVerifiedPackageArtifactBytes,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { readReleaseManifest } from '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';
import {
  compilerDispatcherCaller,
  compilerDispatcherImport,
  observedCompilerBuild,
  owningModuleUrlBuiltin,
  owningSelfExportRequire,
  readCompilerActivationCatalogue,
} from './compiler-activation-proof.mjs';
import { nativeDevelopmentLoaderImport } from './native-development-loader.mjs';

const octaneTypeEvidencePath =
  'scripts/ultramodern-renderers/acceptance/evidence/octane-native-runtime-type-interop.json.txt';
const octaneTypeEvidenceSha256 =
  '79e2eaa567552bffb96f656be0bf4c4eef7bd64d1b48316881e6967539495277';

function readOctaneTypeEvidence() {
  const file = path.join(repoRoot, octaneTypeEvidencePath);
  assert(
    fs.lstatSync(file).isFile() && within(repoRoot, fs.realpathSync(file)),
    'Octane native type evidence must be an ordinary owning repository file',
  );
  const bytes = fs.readFileSync(file);
  assert(
    crypto.createHash('sha256').update(bytes).digest('hex') ===
      octaneTypeEvidenceSha256,
    'Octane native type evidence differs from the authenticated source freeze',
  );
  return JSON.parse(bytes);
}

const renderers = new Set(['react', 'solid', 'octane']);
const exactVersion = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u;
const builtins = new Set(
  builtinModules.map(name => name.replace(/^node:/u, '')),
);
const extensions = [
  '',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.mts',
  '.cts',
  '.tsrx',
  '.d.ts',
];
const bundledReact =
  /Symbol\s*\.\s*for\s*\(\s*['"]react\.(?:element|transitional\.element|portal|fragment)['"]|react-server-dom-(?:webpack|turbopack|rspack)/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requireReferenceKind(reference) {
  const parent = reference.parentPath;
  if (parent.isCallExpression() && parent.get('callee').node === reference.node)
    return 'load';
  if (
    parent.isMemberExpression() &&
    !parent.node.computed &&
    parent.get('object').node === reference.node &&
    parent.get('property').isIdentifier({ name: 'resolve' }) &&
    parent.parentPath.isCallExpression() &&
    parent.parentPath.get('callee').node === parent.node
  )
    return 'resolve';
}

// Use the repository's maintained parser without loading its transform config.
function moduleSpecifiers(source, file, additionalRequireNames = new Set()) {
  assert(
    !file.endsWith('.tsrx'),
    `Native .tsrx source closure requires a compiler-owned source module manifest and its compiled JavaScript closure: ${file}`,
  );
  const parsed = parseSync(source, {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: 'unambiguous',
    parserOpts: {
      plugins: [['typescript', { dts: /\.d\.[cm]?ts$/u.test(file) }], 'jsx'],
      createImportExpressions: true,
    },
  });
  assert(parsed, `Source parser produced no module graph for ${file}`);
  const dynamicImports = new Map();
  const requireCalls = new Map();
  const escapedRequireAnchors = [];
  const owningUrlBuiltins = new Set();
  const strictNode = nodeModuleAst({ strict: true });
  const { unwrap, property, namedFunction } = nodeModuleAst();
  const createRequireCall = item => {
    item = unwrap(item);
    const imported = item?.isIdentifier()
      ? item.scope.getBinding(item.node.name)?.path
      : undefined;
    return (
      namedFunction(item, 'createRequire', 'node:module') ||
      property(item, 'createRequire') ||
      item?.isIdentifier({ name: 'createRequire' }) ||
      (imported?.isImportSpecifier() &&
        imported.node.imported.name === 'createRequire')
    );
  };
  traverse(parsed, {
    ImportExpression(importPath) {
      dynamicImports.set(importPath.node.source, importPath);
    },
    CallExpression(callPath) {
      const callee = callPath.get('callee');
      if (owningModuleUrlBuiltin(callPath, globalPrimitiveUnchanged))
        owningUrlBuiltins.add(callPath.node);
      if (createRequireCall(callee)) {
        if (
          callPath.get('arguments').length === 1 &&
          requireReferenceKind(callPath) === 'resolve' &&
          strictNode.namedFunction(
            strictNode.unwrap(callee),
            'createRequire',
            'node:module',
          )
        )
          return;
        const owner = callPath.parentPath;
        const binding =
          owner.isVariableDeclarator() &&
          owner.get('id').isIdentifier() &&
          owner.scope.getBinding(owner.node.id.name);
        if (
          !binding ||
          !binding.constant ||
          binding.referencePaths.some(
            reference => !requireReferenceKind(reference),
          )
        )
          escapedRequireAnchors.push(callPath);
      }
      if (!callee.isIdentifier()) return;
      const binding = callee.scope.getBinding(callee.node.name);
      const init = binding?.path.isVariableDeclarator()
        ? binding.path.get('init')
        : undefined;
      if (init?.isCallExpression() && createRequireCall(init.get('callee')))
        requireCalls.set(callPath.node, callPath);
    },
  });
  const imports = [];
  const add = (node, options = {}) =>
    imports.push({
      specifier: node?.type === 'StringLiteral' ? node.value : undefined,
      computed: node?.type !== 'StringLiteral',
      line: node?.loc?.start.line,
      ...options,
    });
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
      ].includes(node.type) &&
      node.source
    )
      add(node.source, {
        namespaceTypeImport:
          node.type === 'ImportDeclaration' &&
          node.importKind === 'type' &&
          node.specifiers?.length === 1 &&
          node.specifiers[0].type === 'ImportNamespaceSpecifier',
        exportTypeAll:
          node.type === 'ExportAllDeclaration' && node.exportKind === 'type',
        typeOnly:
          node.importKind === 'type' ||
          node.exportKind === 'type' ||
          (node.specifiers?.length > 0 &&
            node.specifiers.every(
              specifier =>
                specifier.importKind === 'type' ||
                specifier.exportKind === 'type',
            )),
      });
    else if (node.type === 'ImportExpression')
      add(node.source, { importPath: dynamicImports.get(node.source) });
    else if (node.type === 'CallExpression' && node.callee?.type === 'Import')
      add(node.arguments[0]);
    else if (node.type === 'CallExpression' && owningUrlBuiltins.has(node))
      add({ type: 'StringLiteral', value: 'url' }, { require: true });
    else if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      (/^(?:__)?require$/u.test(node.callee.name) ||
        additionalRequireNames.has(node.callee.name) ||
        requireCalls.has(node))
    )
      add(node.arguments[0], {
        require: true,
        requirePath: requireCalls.get(node),
      });
    else if (node.type === 'TSImportType')
      add(node.source ?? node.argument, { typeOnly: true });
    else if (
      node.type === 'TSImportEqualsDeclaration' &&
      node.moduleReference?.type === 'TSExternalModuleReference'
    )
      add(node.moduleReference.expression, {
        require: true,
        typeOnly: node.importKind === 'type',
      });
    else if (
      node.type === 'TSModuleDeclaration' &&
      node.id?.type === 'StringLiteral'
    )
      add(node.id, { augmentation: true, typeOnly: true });
    for (const [key, child] of Object.entries(node)) {
      if (!['loc', 'start', 'end', 'comments', 'tokens', 'extra'].includes(key))
        visit(child);
    }
  };
  visit(parsed.program);
  for (const requirePath of escapedRequireAnchors)
    imports.push({
      computed: true,
      require: true,
      requirePath,
      line: requirePath.node.loc.start.line,
    });
  for (const match of source.matchAll(
    /^[\t ]*\/\/\/\s*<reference\s+(types|path)\s*=\s*['"]([^'"]+)['"]/gmu,
  ))
    imports.push({
      specifier: match[2],
      reference: match[1],
      line: source.slice(0, match.index).split('\n').length,
      typeOnly: true,
      computed: false,
    });
  for (const match of source.matchAll(/@jsxImportSource\s+([^\s*]+)/gu))
    imports.push({
      specifier: match[1],
      typeOnly: true,
      jsxSource: true,
      computed: false,
    });
  return imports;
}

function astFunctionShape(helper, externalBinding) {
  const roles = new Map([[externalBinding, 'runtime']]);
  const names = new Map();
  helper.traverse({
    Identifier(item) {
      if (!item.isBindingIdentifier() && !item.isReferencedIdentifier()) return;
      const binding = item.scope.getBinding(item.node.name);
      if (binding && !roles.has(binding))
        roles.set(binding, `local-${roles.size}`);
      names.set(item.node, roles.get(binding) ?? `global-${item.node.name}`);
    },
  });
  const ignored = new Set([
    'start',
    'end',
    'loc',
    'extra',
    'leadingComments',
    'trailingComments',
    'innerComments',
    'id',
    'generator',
    'async',
  ]);
  const normalize = node => {
    if (Array.isArray(node)) return node.map(normalize);
    if (!node || typeof node !== 'object') return node;
    const entries = Object.entries(node).filter(
      ([key, value]) =>
        !ignored.has(key) &&
        !(key === 'expression' && typeof value === 'boolean'),
    );
    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type))
      entries.push(
        ['async', Boolean(node.async)],
        ['generator', Boolean(node.generator)],
      );
    return Object.fromEntries(
      entries
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [
          key,
          key === 'name' && names.has(node)
            ? names.get(node)
            : key === 'type' && node.type === 'ArrowFunctionExpression'
              ? 'FunctionExpression'
              : normalize(value),
        ]),
    );
  };
  return JSON.stringify(normalize(helper.node));
}

let interopShapes;
function supportedInteropShapes() {
  if (interopShapes) return interopShapes;
  const parsed = parseSync(
    `
    var runtime = {};
    const simple = value => () => value;
    const compiler = module => {
      var getter = module && module.__esModule ? () => module['default'] : () => module;
      runtime.d(getter, { a: getter });
      return getter;
    };
    const define = (exports, getters, values) => {
      var define = (defs, kind) => {
        for (var key in defs) if (runtime.o(defs, key) && !runtime.o(exports, key)) Object.defineProperty(exports, key, { enumerable: true, [kind]: defs[key] });
      };
      define(getters, 'get');
      define(values, 'value');
    };
    const owns = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
  `,
    { babelrc: false, configFile: false },
  );
  interopShapes = new Map();
  traverse(parsed, {
    VariableDeclarator(item) {
      if (
        item.parentPath.parentPath.isProgram() &&
        ['simple', 'compiler', 'define', 'owns'].includes(item.node.id.name)
      )
        interopShapes.set(
          item.node.id.name,
          astFunctionShape(item.get('init'), item.scope.getBinding('runtime')),
        );
    },
  });
  return interopShapes;
}

function globalPrimitiveUnchanged(item, name) {
  let valid = true;
  const matches = (expression, seen = new Set()) => {
    while (expression?.isMemberExpression())
      expression = expression.get('object');
    if (!expression?.isIdentifier() || seen.has(expression.node)) return false;
    seen.add(expression.node);
    const binding = expression.scope.getBinding(expression.node.name);
    if (!binding) return expression.node.name === name;
    return (
      ['Object', 'JSON', 'String'].includes(name) &&
      binding.path.isVariableDeclarator() &&
      matches(binding.path.get('init'), seen)
    );
  };
  const target = expression => {
    if (expression?.isArrayPattern()) {
      expression.get('elements').forEach(target);
      return;
    }
    if (expression?.isObjectPattern()) {
      expression
        .get('properties')
        .forEach(property =>
          target(
            property.isRestElement()
              ? property.get('argument')
              : property.get('value'),
          ),
        );
      return;
    }
    if (expression?.isAssignmentPattern()) {
      target(expression.get('left'));
      return;
    }
    if (expression?.isRestElement()) {
      target(expression.get('argument'));
      return;
    }
    if (matches(expression)) valid = false;
  };
  item.scope.getProgramParent().path.traverse({
    AssignmentExpression(expression) {
      target(expression.get('left'));
    },
    UpdateExpression(expression) {
      target(expression.get('argument'));
    },
    UnaryExpression(expression) {
      if (expression.node.operator === 'delete')
        target(expression.get('argument'));
    },
    ForInStatement(expression) {
      if (!expression.get('left').isVariableDeclaration())
        target(expression.get('left'));
    },
    ForOfStatement(expression) {
      if (!expression.get('left').isVariableDeclaration())
        target(expression.get('left'));
    },
    ReferencedIdentifier(reference) {
      if (!['Object', 'JSON', 'String'].includes(name) || !matches(reference))
        return;
      let value = reference;
      let parent = value.parentPath;
      while (
        parent.isMemberExpression() &&
        !parent.node.computed &&
        parent.get('object').node === value.node
      ) {
        value = parent;
        parent = value.parentPath;
      }
      const directCall =
        (parent.isCallExpression() || parent.isNewExpression()) &&
        parent.get('callee').node === value.node;
      const alias =
        parent.isVariableDeclarator() &&
        parent.get('init').node === value.node &&
        parent.get('id').isIdentifier();
      if (!directCall && !alias) valid = false;
    },
  });
  return valid;
}

function compilerInteropUnchanged(object) {
  if (!object?.isIdentifier()) return false;
  const binding = object.scope.getBinding(object.node.name);
  if (
    !binding?.constant ||
    !binding.path.isVariableDeclarator() ||
    !binding.path.get('init').isObjectExpression() ||
    binding.path.get('init.properties').length !== 0
  )
    return false;
  const definitions = new Map();
  for (const reference of binding.referencePaths) {
    const member = reference.parentPath;
    if (
      !member.isMemberExpression() ||
      member.node.computed ||
      member.get('object').node !== reference.node
    )
      return false;
    const name = member.node.property.name;
    const use = member.parentPath;
    if (
      use.isAssignmentExpression({ operator: '=' }) &&
      use.get('left').node === member.node &&
      use.get('right').isFunction()
    ) {
      const items = definitions.get(name) ?? [];
      items.push(use.get('right'));
      definitions.set(name, items);
    } else if (
      !use.isCallExpression() ||
      use.get('callee').node !== member.node
    )
      return false;
  }
  const getter = definitions.get('n');
  if (getter?.length !== 1) return false;
  const shapes = supportedInteropShapes();
  const shape = astFunctionShape(getter[0], binding);
  if (shape === shapes.get('simple')) return true;
  return (
    shape === shapes.get('compiler') &&
    globalPrimitiveUnchanged(object, 'Object') &&
    ['d', 'o'].every(
      (name, index) =>
        definitions.get(name)?.length === 1 &&
        astFunctionShape(definitions.get(name)[0], binding) ===
          shapes.get(index === 0 ? 'define' : 'owns'),
    )
  );
}

function nodeBuiltinUnchanged(item, module, syntax) {
  const program = item.scope.getProgramParent().path;
  const bindings = new Set();
  const kind = (declaration, seen = new Set()) => {
    if (!declaration?.node || seen.has(declaration.node)) return;
    seen.add(declaration.node);
    if (declaration.isImportSpecifier()) return 'function';
    if (
      declaration.isImportDefaultSpecifier() ||
      declaration.isImportNamespaceSpecifier()
    )
      return 'object';
    if (!declaration.isVariableDeclarator()) return;
    const init = declaration.get('init');
    if (init.isIdentifier())
      return kind(init.scope.getBinding(init.node.name)?.path, seen);
    if (init.isMemberExpression()) return 'function';
    if (init.isCallExpression())
      return syntax.property(syntax.unwrap(init.get('callee')), 'n')
        ? 'getter'
        : 'object';
  };
  let valid = true;
  const use = (value, role) => {
    let parent = value.parentPath;
    if (role === 'getter') {
      if (
        !parent.isCallExpression() ||
        parent.get('callee').node !== value.node ||
        parent.get('arguments').length !== 0
      )
        return false;
      value = parent;
      parent = value.parentPath;
      role = 'object';
    }
    if (role === 'function')
      return (
        parent.isCallExpression() && parent.get('callee').node === value.node
      );
    if (
      parent.isVariableDeclarator() &&
      parent.get('init').node === value.node &&
      parent.get('id').isIdentifier()
    )
      return true;
    if (
      parent.isCallExpression() &&
      parent.get('arguments').some(argument => argument.node === value.node)
    ) {
      const callee = syntax.unwrap(parent.get('callee'));
      return (
        syntax.property(callee, 'n') &&
        compilerInteropUnchanged(callee.get('object')) &&
        parent.get('arguments').length === 1
      );
    }
    if (
      !parent.isMemberExpression() ||
      parent.node.computed ||
      parent.get('object').node !== value.node
    )
      return false;
    const member = parent;
    parent = member.parentPath;
    if (
      parent.isSequenceExpression() &&
      parent.get('expressions').length === 2 &&
      parent.get('expressions')[0].isNumericLiteral({ value: 0 }) &&
      parent.get('expressions')[1].node === member.node
    )
      parent = parent.parentPath;
    if (
      parent.isCallExpression() &&
      syntax.unwrap(parent.get('callee')).node === member.node
    )
      return true;
    return (
      member.node.property.name === 'sep' &&
      !(
        parent.isAssignmentExpression() &&
        parent.get('left').node === member.node
      ) &&
      !parent.isUpdateExpression() &&
      !parent.isUnaryExpression({ operator: 'delete' })
    );
  };
  program.traverse({
    BindingIdentifier(identifier) {
      const binding = identifier.scope.getBinding(identifier.node.name);
      if (!binding || bindings.has(binding)) return;
      bindings.add(binding);
      const declaration = binding.path;
      const origin =
        declaration.isImportSpecifier() ||
        declaration.isImportDefaultSpecifier() ||
        declaration.isImportNamespaceSpecifier()
          ? declaration.parentPath.node.source.value
          : declaration.isVariableDeclarator()
            ? syntax.origin(declaration.get('init'))
            : undefined;
      if (
        origin === module &&
        (!binding.constant ||
          binding.referencePaths.some(
            reference => !use(reference, kind(declaration)),
          ))
      )
        valid = false;
    },
    CallExpression(call) {
      if (
        syntax.origin(call) === module &&
        !call.parentPath.isVariableDeclarator() &&
        !use(call, 'object')
      )
        valid = false;
    },
  });
  return valid;
}

function nodeModuleAst({ strict = false } = {}) {
  const plain = strict ? nodeModuleAst() : undefined;
  const checked = new Map();
  const unwrap = item => {
    if (item?.isSequenceExpression()) {
      const expressions = item.get('expressions');
      return expressions.length === 2 &&
        expressions[0].isNumericLiteral({ value: 0 })
        ? unwrap(expressions[1])
        : undefined;
    }
    if (item?.isTSNonNullExpression()) return unwrap(item.get('expression'));
    return item;
  };
  const property = (item, name) => {
    item = unwrap(item);
    return (
      (item?.isMemberExpression() || item?.isOptionalMemberExpression()) &&
      !item.node.computed &&
      item.node.property.name === name
    );
  };
  const rawOrigin = (item, seen = new Set()) => {
    item = unwrap(item);
    if (!item?.node || seen.has(item.node)) return undefined;
    seen.add(item.node);
    if (item.isIdentifier()) {
      const binding = item.scope.getBinding(item.node.name);
      if (!binding || !binding.constant) return undefined;
      const declaration = binding.path;
      if (
        declaration.isImportSpecifier() ||
        declaration.isImportNamespaceSpecifier() ||
        declaration.isImportDefaultSpecifier()
      )
        return declaration.parentPath.node.source.value;
      if (declaration.isVariableDeclarator())
        return origin(declaration.get('init'), seen);
      return undefined;
    }
    if (item.isMemberExpression()) return origin(item.get('object'), seen);
    if (item.isCallExpression()) {
      const callee = unwrap(item.get('callee'));
      const args = item.get('arguments');
      if (
        callee?.isIdentifier({ name: 'require' }) &&
        !callee.scope.getBinding('require') &&
        args.length === 1 &&
        args[0].isStringLiteral()
      )
        return args[0].node.value;
      const interop =
        property(callee, 'n') &&
        callee.get('object').isIdentifier({ name: '__webpack_require__' }) &&
        callee.scope
          .getBinding('__webpack_require__')
          ?.path.isVariableDeclarator() &&
        callee.scope
          .getBinding('__webpack_require__')
          .path.get('init')
          .isObjectExpression() &&
        callee.scope
          .getBinding('__webpack_require__')
          .path.get('init.properties').length === 0;
      if (interop && strict && !compilerInteropUnchanged(callee.get('object')))
        return undefined;
      if (interop && args.length === 1) return origin(args[0], seen);
      if (args.length === 0 && callee?.isIdentifier()) {
        const declaration = callee.scope.getBinding(callee.node.name)?.path;
        if (
          declaration?.isVariableDeclarator() &&
          declaration.get('init').isCallExpression() &&
          property(declaration.get('init.callee'), 'n')
        )
          return origin(callee, seen);
      }
    }
    return undefined;
  };
  const origin = (item, seen = new Set()) => {
    const module = rawOrigin(item, seen);
    if (!strict || !module?.startsWith('node:')) return module;
    const program = item.scope.getProgramParent().path.node;
    const byModule = checked.get(program) ?? new Map();
    checked.set(program, byModule);
    if (!byModule.has(module))
      byModule.set(module, nodeBuiltinUnchanged(item, module, plain));
    return byModule.get(module) ? module : undefined;
  };
  const method = (item, name, module) =>
    property(item, name) && origin(item.get('object')) === module;
  const namedFunction = (item, name, module) => {
    item = unwrap(item);
    if (method(item, name, module)) return true;
    if (!item?.isIdentifier() || origin(item) !== module) return false;
    const declaration = item.scope.getBinding(item.node.name)?.path;
    return (
      declaration?.isImportSpecifier() &&
      declaration.node.imported.name === name
    );
  };
  const sameBinding = (a, b) =>
    a?.isIdentifier() &&
    b?.isIdentifier() &&
    a.scope.getBinding(a.node.name) === b.scope.getBinding(b.node.name) &&
    Boolean(a.scope.getBinding(a.node.name));
  return { unwrap, property, origin, method, namedFunction, sameBinding };
}

export function compilerActivationAstAuthority() {
  return {
    syntax: nodeModuleAst({ strict: true }),
    primitiveUnchanged: globalPrimitiveUnchanged,
  };
}

// Interpret only Node file anchors and a complete, bounded package locator.
// Package bytes and the actual filesystem guard observations are bound below.
function createRequireAnchor(callPath) {
  const { unwrap, method, namedFunction, sameBinding } = nodeModuleAst({
    strict: true,
  });
  const callee = callPath.get('callee');
  const binding = callee.scope.getBinding(callee.node.name);
  const declaration = binding?.path;
  if (!binding?.constant || !declaration?.isVariableDeclarator()) return;
  const init = declaration.get('init');
  if (
    !init.isCallExpression() ||
    !namedFunction(
      unwrap(init.get('callee')),
      'createRequire',
      'node:module',
    ) ||
    init.get('arguments').length !== 1
  )
    return;
  if (
    binding.referencePaths.some(reference => !requireReferenceKind(reference))
  )
    return;
  const global = (item, name) =>
    item?.isIdentifier({ name }) &&
    !item.scope.getBinding(name) &&
    globalPrimitiveUnchanged(item, name);
  const metaUrl = item =>
    item?.isMemberExpression() &&
    !item.node.computed &&
    item.get('property').isIdentifier({ name: 'url' }) &&
    item.get('object').isMetaProperty() &&
    item.node.object.meta.name === 'import' &&
    item.node.object.property.name === 'meta';
  const variable = item => {
    if (!item?.isIdentifier()) return;
    const local = item.scope.getBinding(item.node.name);
    return local?.constant && local.path.isVariableDeclarator()
      ? local.path.get('init')
      : undefined;
  };
  const currentDirectory = (item, seen = new Set()) => {
    if (!item?.node || seen.has(item.node)) return false;
    seen.add(item.node);
    if (global(item, '__dirname')) return true;
    const value = variable(item);
    if (value) return currentDirectory(value, seen);
    if (
      !item.isCallExpression() ||
      !namedFunction(unwrap(item.get('callee')), 'dirname', 'node:path') ||
      item.get('arguments').length !== 1
    )
      return false;
    const filename = item.get('arguments')[0];
    return (
      filename.isCallExpression() &&
      namedFunction(
        unwrap(filename.get('callee')),
        'fileURLToPath',
        'node:url',
      ) &&
      filename.get('arguments').length === 1 &&
      metaUrl(filename.get('arguments')[0])
    );
  };
  const join = item =>
    item?.isCallExpression() &&
    method(unwrap(item.get('callee')), 'join', 'node:path') &&
    item.get('arguments').length === 2
      ? item.get('arguments')
      : undefined;
  const literalPath = item =>
    item?.isStringLiteral() &&
    item.node.value &&
    !path.posix.isAbsolute(item.node.value) &&
    !item.node.value.includes('\\') &&
    path.posix.normalize(item.node.value) === item.node.value &&
    !item.node.value
      .split('/')
      .some(segment => segment === '.' || segment === '..')
      ? item.node.value
      : undefined;
  const argument = init.get('arguments')[0];
  if (metaUrl(argument) || global(argument, '__filename'))
    return { kind: 'file' };
  const anchor = join(argument);
  const logicalFilename = anchor && literalPath(anchor[1]);
  if (!anchor || !logicalFilename) return;
  if (currentDirectory(anchor[0])) return { kind: 'file', logicalFilename };
  const directoryCall = variable(anchor[0]);
  if (
    !directoryCall?.isCallExpression() ||
    directoryCall.get('arguments').length !== 0 ||
    !directoryCall.get('callee').isIdentifier()
  )
    return;
  const locatorBinding = directoryCall.scope.getBinding(
    directoryCall.node.callee.name,
  );
  const locator = locatorBinding?.path;
  if (
    !locatorBinding?.constant ||
    !locator?.isFunctionDeclaration() ||
    locator.node.async ||
    locator.node.generator ||
    locator.get('params').length !== 0
  )
    return;
  const body = locator.get('body.body');
  if (
    body.length !== 2 ||
    !body[0].isVariableDeclaration({ kind: 'let' }) ||
    body[0].get('declarations').length !== 1 ||
    !body[1].isWhileStatement() ||
    !body[1].get('test').isBooleanLiteral({ value: true }) ||
    !body[1].get('body').isBlockStatement()
  )
    return;
  const cursor = body[0].get('declarations')[0];
  if (!cursor.get('id').isIdentifier() || !currentDirectory(cursor.get('init')))
    return;
  const statements = body[1].get('body.body');
  if (![5, 6].includes(statements.length)) return;
  const localDeclaration = statement =>
    statement?.isVariableDeclaration({ kind: 'const' }) &&
    statement.get('declarations').length === 1 &&
    statement.get('declarations')[0].get('id').isIdentifier()
      ? statement.get('declarations')[0]
      : undefined;
  const compiler = localDeclaration(statements[statements.length - 5]);
  const compilerPath = compiler && join(compiler.get('init'));
  const relativeDirectory = compilerPath && literalPath(compilerPath[1]);
  if (!relativeDirectory || !sameBinding(compilerPath[0], cursor.get('id')))
    return;
  const manifest =
    statements.length === 6 ? localDeclaration(statements[0]) : undefined;
  if (statements.length === 6 && !manifest) return;
  const manifestPath = manifest && join(manifest.get('init'));
  if (
    manifest &&
    (!manifestPath ||
      !sameBinding(manifestPath[0], cursor.get('id')) ||
      !manifestPath[1].isStringLiteral({ value: 'package.json' }))
  )
    return;
  const guard = statements[statements.length - 4];
  const single = item =>
    item?.isBlockStatement() && item.get('body').length === 1
      ? item.get('body')[0]
      : item;
  if (
    !guard.isIfStatement() ||
    guard.node.alternate ||
    !guard.get('test').isLogicalExpression({ operator: '&&' }) ||
    !single(guard.get('consequent')).isReturnStatement() ||
    !sameBinding(
      single(guard.get('consequent')).get('argument'),
      compiler.get('id'),
    )
  )
    return;
  const exists = item =>
    item?.isCallExpression() &&
    method(unwrap(item.get('callee')), 'existsSync', 'node:fs') &&
    item.get('arguments').length === 1
      ? item.get('arguments')[0]
      : undefined;
  const packageGuard = exists(guard.get('test.left'));
  const inlineManifest = packageGuard && join(packageGuard);
  if (
    !(manifest
      ? sameBinding(packageGuard, manifest.get('id'))
      : inlineManifest &&
        sameBinding(inlineManifest[0], cursor.get('id')) &&
        inlineManifest[1].isStringLiteral({ value: 'package.json' }))
  )
    return;
  const sentinelPath = join(exists(guard.get('test.right')));
  const sentinel = sentinelPath && literalPath(sentinelPath[1]);
  if (!sentinel || !sameBinding(sentinelPath[0], compiler.get('id'))) return;
  const parent = localDeclaration(statements[statements.length - 3]);
  const parentInit = parent?.get('init');
  if (
    !parentInit?.isCallExpression() ||
    !method(unwrap(parentInit.get('callee')), 'dirname', 'node:path') ||
    parentInit.get('arguments').length !== 1 ||
    !sameBinding(parentInit.get('arguments')[0], cursor.get('id'))
  )
    return;
  const stop = statements[statements.length - 2];
  if (
    !stop.isIfStatement() ||
    stop.node.alternate ||
    !stop.get('test').isBinaryExpression({ operator: '===' }) ||
    !sameBinding(stop.get('test.left'), parent.get('id')) ||
    !sameBinding(stop.get('test.right'), cursor.get('id'))
  )
    return;
  const thrown = single(stop.get('consequent'));
  const error = thrown.isThrowStatement() ? thrown.get('argument') : undefined;
  if (
    !error?.isNewExpression() ||
    !global(error.get('callee'), 'Error') ||
    error.get('arguments').length !== 1 ||
    !error.get('arguments')[0].isStringLiteral()
  )
    return;
  const update = statements[statements.length - 1];
  if (
    !update.isExpressionStatement() ||
    !update.get('expression').isAssignmentExpression({ operator: '=' }) ||
    !sameBinding(update.get('expression.left'), cursor.get('id')) ||
    !sameBinding(update.get('expression.right'), parent.get('id'))
  )
    return;
  if (
    [compiler, parent, manifest]
      .filter(Boolean)
      .some(item => !item.scope.getBinding(item.node.id.name)?.constant)
  )
    return;
  const cursorBinding = cursor.scope.getBinding(cursor.node.id.name);
  if (
    cursorBinding.constantViolations.length !== 1 ||
    cursorBinding.constantViolations[0].node !== update.get('expression').node
  )
    return;
  return {
    kind: 'package',
    relativeDirectory,
    sentinel,
    logicalFilename,
    locatorLine: locator.node.loc.start.line,
  };
}

// Recognize one compiler-owned Node loader with its dominating path guards.
// Ownership and bytes are authenticated separately against the release tarball.
function nativeServerLoaderImport(importPath, aliases) {
  if (
    typeof aliases['@modern-js/utils'] !== 'string' ||
    typeof aliases['@modern-js/renderer-core'] !== 'string'
  )
    return false;
  const { property, method, namedFunction, sameBinding } = nodeModuleAst();
  const memberChain = (item, names) => {
    for (const name of [...names].reverse()) {
      if (!property(item, name)) return undefined;
      item = item.get('object');
    }
    return item;
  };
  const throws = item =>
    item?.isThrowStatement() ||
    (item?.isBlockStatement() &&
      item.get('body').length === 1 &&
      item.get('body')[0].isThrowStatement());
  const unequal = (item, a, b) =>
    item?.isBinaryExpression() &&
    ['!==', '!='].includes(item.node.operator) &&
    ((a(item.get('left')) && b(item.get('right'))) ||
      (a(item.get('right')) && b(item.get('left'))));
  if (!importPath?.isImportExpression()) return false;
  const source = importPath.get('source');
  if (
    !source.isTemplateLiteral() ||
    source.node.quasis.map(item => item.value.cooked).join('|') !==
      '|?build=|' ||
    source.get('expressions').length !== 2
  )
    return false;
  const [url, buildId] = source.get('expressions');
  if (!property(url, 'href') || !property(buildId, 'buildId')) return false;
  const identity = buildId.get('object');
  const urlCall = url.get('object');
  if (
    !urlCall.isCallExpression() ||
    !namedFunction(urlCall.get('callee'), 'pathToFileURL', 'node:url') ||
    urlCall.get('arguments').length !== 1
  )
    return false;
  const joined = urlCall.get('arguments')[0];
  if (
    !joined.isCallExpression() ||
    !method(joined.get('callee'), 'join', 'node:path') ||
    joined.get('arguments').length !== 2
  )
    return false;
  const [serverPath, fileZero] = joined.get('arguments');
  const server = memberChain(serverPath, [
    'compilation',
    'outputOptions',
    'path',
  ]);
  if (
    !server?.isIdentifier() ||
    !fileZero.isMemberExpression() ||
    !fileZero.node.computed ||
    !fileZero.get('property').isNumericLiteral({ value: 0 })
  )
    return false;
  const files = fileZero.get('object');
  const declaration = importPath.findParent(item =>
    item.isVariableDeclarator(),
  );
  const statement = declaration?.parentPath;
  const block = statement?.parentPath;
  if (
    !declaration?.get('id').isIdentifier() ||
    !declaration.get('init').isAwaitExpression() ||
    declaration.get('init.argument').node !== importPath.node ||
    !block?.isBlockStatement()
  )
    return false;
  const statements = block.get('body');
  const index = statements.findIndex(item => item.node === statement.node);
  const one = statements[index - 2],
    canonical = statements[index - 1];
  if (
    !one?.isIfStatement() ||
    one.node.alternate ||
    !throws(one.get('consequent')) ||
    !unequal(
      one.get('test'),
      item =>
        property(item, 'length') && sameBinding(item.get('object'), files),
      item => item.isNumericLiteral({ value: 1 }),
    )
  )
    return false;
  const nativeBundleDirectory = aliases['@modern-js/utils'];
  const canonicalPath = item => {
    if (
      !item.isCallExpression() ||
      !property(item.get('callee'), 'join') ||
      item.get('arguments').length !== 1 ||
      !item.get('arguments')[0].isStringLiteral({ value: '/' })
    )
      return false;
    const split = item.get('callee.object');
    if (
      !split.isCallExpression() ||
      !property(split.get('callee'), 'split') ||
      split.get('arguments').length !== 1 ||
      !method(split.get('arguments')[0], 'sep', 'node:path')
    )
      return false;
    const relative = split.get('callee.object');
    if (
      !relative.isCallExpression() ||
      !method(relative.get('callee'), 'relative', 'node:path') ||
      relative.get('arguments').length !== 2
    )
      return false;
    const [dist, target] = relative.get('arguments');
    if (
      !property(dist, 'distDirectory') ||
      !dist.get('object').isCallExpression() ||
      !property(dist.get('object.callee'), 'getAppContext') ||
      dist.get('object.arguments').length !== 0
    )
      return false;
    if (
      !target.isCallExpression() ||
      !method(target.get('callee'), 'join', 'node:path') ||
      target.get('arguments').length !== 2
    )
      return false;
    const [pathTarget, indexTarget] = target.get('arguments');
    return (
      sameBinding(
        memberChain(pathTarget, ['compilation', 'outputOptions', 'path']),
        server,
      ) &&
      indexTarget.isMemberExpression() &&
      indexTarget.node.computed &&
      indexTarget.get('property').isNumericLiteral({ value: 0 }) &&
      sameBinding(indexTarget.get('object'), files)
    );
  };
  let entryName;
  const canonicalTemplate = item => {
    if (
      !item.isTemplateLiteral() ||
      item.node.quasis.map(item => item.value.cooked).join('|') !== '|/|.js' ||
      item.get('expressions').length !== 2
    )
      return false;
    const [directory, entry] = item.get('expressions');
    if (
      !nativeBundleDirectory ||
      !namedFunction(
        directory,
        'SERVER_BUNDLE_DIRECTORY',
        nativeBundleDirectory,
      ) ||
      !entry.isIdentifier()
    )
      return false;
    entryName = entry;
    return true;
  };
  if (
    !canonical?.isIfStatement() ||
    canonical.node.alternate ||
    !throws(canonical.get('consequent')) ||
    !unequal(canonical.get('test'), canonicalPath, canonicalTemplate)
  )
    return false;
  const identityDeclaration =
    identity.isIdentifier() &&
    identity.scope.getBinding(identity.node.name)?.path;
  const loop = identityDeclaration?.findParent(item => item.isForOfStatement());
  if (
    !loop ||
    !loop.node.left.declarations?.[0]?.id ||
    loop.node.left.declarations[0].id.type !== 'ArrayPattern'
  )
    return false;
  const entries = loop.get('right');
  if (
    !entries.isCallExpression() ||
    !property(entries.get('callee'), 'entries') ||
    !entries.get('callee.object').isIdentifier({ name: 'Object' }) ||
    entries.scope.getBinding('Object') ||
    entries.get('arguments').length !== 1 ||
    !property(entries.get('arguments')[0], 'identities')
  )
    return false;
  const pattern = loop.get('left.declarations.0.id.elements');
  if (
    pattern.length !== 2 ||
    !sameBinding(pattern[0], entryName) ||
    !sameBinding(pattern[1], identity)
  )
    return false;
  const filesDeclaration =
    files.isIdentifier() && files.scope.getBinding(files.node.name)?.path;
  const fileInit = filesDeclaration?.isVariableDeclarator()
    ? filesDeclaration.get('init')
    : undefined;
  if (
    !filesDeclaration?.scope.getBinding(files.node.name)?.constant ||
    !fileInit?.isConditionalExpression() ||
    !fileInit.get('test').isIdentifier() ||
    !fileInit.get('alternate').isArrayExpression() ||
    fileInit.get('alternate.elements').length !== 0
  )
    return false;
  const chunk = fileInit.get('test');
  const filtered = fileInit.get('consequent');
  if (
    !filtered.isCallExpression() ||
    !property(filtered.get('callee'), 'filter') ||
    !filtered.get('callee.object').isArrayExpression() ||
    filtered.get('callee.object.elements').length !== 1 ||
    filtered.get('arguments').length !== 1
  )
    return false;
  const spread = filtered.get('callee.object.elements')[0];
  const predicate = filtered.get('arguments')[0];
  if (
    !spread.isSpreadElement() ||
    !property(spread.get('argument'), 'files') ||
    !sameBinding(spread.get('argument.object'), chunk) ||
    !predicate.isArrowFunctionExpression() ||
    predicate.get('params').length !== 1 ||
    !predicate.get('params')[0].isIdentifier()
  )
    return false;
  const testedFile = predicate.get('body');
  if (
    !testedFile.isCallExpression() ||
    !property(testedFile.get('callee'), 'test') ||
    !testedFile.get('callee.object').isRegExpLiteral() ||
    testedFile.get('callee.object').node.pattern !== '\\.[cm]?js$' ||
    testedFile.get('callee.object').node.flags !== 'u' ||
    testedFile.get('arguments').length !== 1 ||
    !sameBinding(testedFile.get('arguments')[0], predicate.get('params')[0])
  )
    return false;
  const chunkDeclaration = chunk.scope.getBinding(chunk.node.name)?.path;
  const chunkInit = chunkDeclaration?.isVariableDeclarator()
    ? chunkDeclaration.get('init')
    : undefined;
  const isCall = item =>
    item?.isCallExpression() || item?.isOptionalCallExpression();
  if (
    !chunk.scope.getBinding(chunk.node.name)?.constant ||
    !isCall(chunkInit) ||
    !property(chunkInit.get('callee'), 'getEntrypointChunk') ||
    chunkInit.get('arguments').length !== 0
  )
    return false;
  const getChunk = chunkInit.get('callee.object');
  if (
    !isCall(getChunk) ||
    !property(getChunk.get('callee'), 'get') ||
    !sameBinding(
      memberChain(getChunk.get('callee.object'), [
        'compilation',
        'entrypoints',
      ]),
      server,
    ) ||
    getChunk.get('arguments').length !== 1 ||
    !sameBinding(getChunk.get('arguments')[0], entryName)
  )
    return false;
  const loaded = declaration.get('id');
  const exportedStatement = statements[index + 1];
  if (
    !exportedStatement?.isVariableDeclaration() ||
    exportedStatement.get('declarations').length !== 1
  )
    return false;
  const exportedDeclaration = exportedStatement.get('declarations')[0];
  const exported = exportedDeclaration.get('id'),
    choice = exportedDeclaration.get('init');
  if (
    !exported.isIdentifier() ||
    !choice.isConditionalExpression() ||
    !property(choice.get('test'), 'rendererIdentity') ||
    !sameBinding(choice.get('test.object'), loaded) ||
    !sameBinding(choice.get('consequent'), loaded) ||
    !property(choice.get('alternate'), 'default') ||
    !sameBinding(choice.get('alternate.object'), loaded)
  )
    return false;
  const assertStatement = statements[index + 2];
  const identityCall = assertStatement?.isExpressionStatement()
    ? assertStatement.get('expression')
    : undefined;
  if (
    !identityCall?.isCallExpression() ||
    !namedFunction(
      identityCall.get('callee'),
      'assertRendererIdentity',
      aliases['@modern-js/renderer-core'],
    ) ||
    identityCall.get('arguments').length !== 2 ||
    !property(identityCall.get('arguments')[0], 'rendererIdentity') ||
    !sameBinding(identityCall.get('arguments')[0].get('object'), exported) ||
    !sameBinding(identityCall.get('arguments')[1], identity)
  )
    return false;
  const handlers = statements[index + 3];
  const handlerNames = new Set();
  const nativeHandler = item =>
    unequal(
      item,
      typed => {
        if (!typed.isUnaryExpression({ operator: 'typeof' })) return false;
        const value = typed.get('argument');
        if (
          (!property(value, 'nativeRequestHandler') &&
            !property(value, 'nativeCSRRequestHandler')) ||
          !sameBinding(value.get('object'), exported)
        )
          return false;
        handlerNames.add(value.node.property.name);
        return true;
      },
      item => item.isStringLiteral({ value: 'function' }),
    );
  if (
    !handlers?.isIfStatement() ||
    handlers.node.alternate ||
    !throws(handlers.get('consequent')) ||
    !handlers.get('test').isLogicalExpression({ operator: '||' }) ||
    !nativeHandler(handlers.get('test.left')) ||
    !nativeHandler(handlers.get('test.right')) ||
    handlerNames.size !== 2
  )
    return false;
  return true;
}

// This is a static export/literal check. The owning build and serve handlers
// separately execute and assert the actual native transport exports.
function assertNativeServerModuleExports(source, file, identity) {
  const parsed = parseSync(source, {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: 'unambiguous',
  });
  const names = [
    'rendererIdentity',
    'nativeRequestHandler',
    'nativeCSRRequestHandler',
  ];
  const exports = new Map(names.map(name => [name, []]));
  const namespaces = [];
  const replacements = [];
  const namespaceInitializations = new Set();
  let reboundCommonJsGlobal = false;
  const tables = [];
  const propertyName = item =>
    !item.node.computed && (item.node.key?.name ?? item.node.key?.value);
  const memberName = item =>
    item?.isMemberExpression() &&
    !item.node.computed &&
    item.node.property.name;
  const global = (item, name) =>
    item?.isIdentifier({ name }) && !item.scope.getBinding(name);
  const sameReference = (left, right) =>
    left?.isIdentifier() &&
    right?.isIdentifier() &&
    left.node.name === right.node.name &&
    left.scope.getBinding(left.node.name) ===
      right.scope.getBinding(right.node.name);
  const plainNamespace = item => {
    if (!item?.isIdentifier()) return false;
    const binding = item.scope.getBinding(item.node.name);
    return (
      binding?.constant &&
      binding.path.isVariableDeclarator() &&
      binding.path.get('init').isObjectExpression() &&
      binding.path.get('init.properties').length === 0
    );
  };
  const initialized = item => {
    for (
      let child = item, parent = item.parentPath;
      parent;
      child = parent, parent = parent.parentPath
    ) {
      if (parent.isBlockStatement() || parent.isProgram()) {
        const body = parent.get('body');
        const index = body.findIndex(
          statement => statement.node === child.node,
        );
        const abrupt = statement =>
          statement.isReturnStatement() ||
          statement.isThrowStatement() ||
          statement.isBreakStatement() ||
          statement.isContinueStatement() ||
          (statement.isBlockStatement() && statement.get('body').some(abrupt));
        if (index >= 0 && body.slice(0, index).some(abrupt)) return false;
      }
      if (
        parent.isIfStatement() ||
        parent.isConditionalExpression() ||
        parent.isLogicalExpression() ||
        parent.isSwitchStatement() ||
        parent.isLoop() ||
        parent.isTryStatement()
      )
        return false;
      if (parent.isFunction()) {
        const call = parent.parentPath;
        if (
          !call?.isCallExpression() ||
          call.get('callee').node !== parent.node ||
          parent.get('params').length !== 0 ||
          call.get('arguments').length !== 0 ||
          parent.node.async ||
          parent.node.generator
        )
          return false;
      }
    }
    return true;
  };
  // Alpha-normalize the actual compiler helper. Property names, operations,
  // literals, and lexical globals remain exact; formatting and local names do not.
  const helperShape = (helper, runtime) => {
    const runtimeBinding = runtime.scope.getBinding(runtime.node.name);
    const roles = new Map([[runtimeBinding, 'compiler-runtime']]);
    const identifiers = new Map();
    helper.traverse({
      Identifier(item) {
        if (!item.isBindingIdentifier() && !item.isReferencedIdentifier())
          return;
        const binding = item.scope.getBinding(item.node.name);
        if (binding && !roles.has(binding))
          roles.set(binding, `local-${roles.size}`);
        identifiers.set(
          item.node,
          roles.get(binding) ?? `global-${item.node.name}`,
        );
      },
    });
    const ignored = new Set([
      'start',
      'end',
      'loc',
      'extra',
      'leadingComments',
      'trailingComments',
      'innerComments',
      'id',
      'generator',
      'async',
    ]);
    const normalize = node => {
      if (Array.isArray(node)) return node.map(normalize);
      if (!node || typeof node !== 'object') return node;
      if (node.type === 'BlockStatement' && node.body.length === 1)
        return normalize(node.body[0]);
      const entries = Object.entries(node).filter(
        ([key, value]) =>
          !ignored.has(key) &&
          !(key === 'expression' && typeof value === 'boolean'),
      );
      if (['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type))
        entries.push(
          ['async', Boolean(node.async)],
          ['generator', Boolean(node.generator)],
        );
      return Object.fromEntries(
        entries
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [
            key,
            key === 'name' && identifiers.has(node)
              ? identifiers.get(node)
              : key === 'type' && node.type === 'ArrowFunctionExpression'
                ? 'FunctionExpression'
                : normalize(value),
          ]),
      );
    };
    return JSON.stringify(normalize(helper.node));
  };
  const expectedHelpers = new Map();
  const helperSources = {
    d: [
      '(exports1,getters,values)=>{var define=(defs,kind)=>{for(var key in defs)if(__runtime__.o(defs,key)&&!__runtime__.o(exports1,key))Object.defineProperty(exports1,key,{enumerable:true,[kind]:defs[key]});};define(getters,"get");define(values,"value");}',
      '(exports1,definition)=>{for(var key in definition){if(__runtime__.o(definition,key)&&!__runtime__.o(exports1,key)){Object.defineProperty(exports1,key,{enumerable:true,get:definition[key]});}}}',
    ],
    o: ['(obj,prop)=>Object.prototype.hasOwnProperty.call(obj,prop)'],
    r: [
      '(exports1)=>{if(typeof Symbol!=="undefined"&&Symbol.toStringTag){Object.defineProperty(exports1,Symbol.toStringTag,{value:"Module"});}Object.defineProperty(exports1,"__esModule",{value:true});}',
    ],
  };
  for (const [name, sources] of Object.entries(helperSources)) {
    const shapes = sources.map(source => {
      const fixture = parseSync(`var __runtime__={}; const helper=${source};`, {
        babelrc: false,
        configFile: false,
      });
      let shape;
      traverse(fixture, {
        VariableDeclarator(item) {
          if (item.get('id').isIdentifier({ name: 'helper' }))
            shape = helperShape(
              item.get('init'),
              item.scope.getBinding('__runtime__').path.get('id'),
            );
        },
      });
      return shape;
    });
    expectedHelpers.set(name, new Set(shapes));
  }
  const runtimeHelpers = [];
  traverse(parsed, {
    AssignmentExpression(item) {
      const left = item.get('left');
      const name = memberName(left);
      if (
        item.node.operator !== '=' ||
        !['d', 'o', 'r'].includes(name) ||
        !left.get('object').isIdentifier() ||
        !left.scope.getBinding(left.get('object').node.name)
      )
        return;
      const helper = item.get('right');
      runtimeHelpers.push({
        runtime: left.get('object'),
        name,
        path: item,
        canonical:
          initialized(item) &&
          (helper.isArrowFunctionExpression() ||
            helper.isFunctionExpression()) &&
          !helper.node.async &&
          !helper.node.generator &&
          expectedHelpers
            .get(name)
            .has(helperShape(helper, left.get('object'))),
      });
    },
  });
  const canonicalRuntime = (runtime, call) =>
    ['d', 'o'].every(name => {
      const matching = runtimeHelpers.filter(
        helper =>
          helper.name === name && sameReference(helper.runtime, runtime),
      );
      return (
        matching.length === 1 &&
        matching[0].canonical &&
        matching[0].path.node.start < call.node.start
      );
    });
  const getter = item => {
    if (
      item?.isArrowFunctionExpression() ||
      item?.isFunctionExpression() ||
      item?.isObjectMethod()
    ) {
      const body = item.get('body');
      if (!body.isBlockStatement()) return body;
      const statements = body.get('body');
      if (statements.length === 1 && statements[0].isReturnStatement())
        return statements[0].get('argument');
    }
    return undefined;
  };
  const objectExports = (object, direct = false) => {
    if (!object?.isObjectExpression()) return [];
    return object.get('properties').flatMap(property => {
      const name = propertyName(property);
      if (!names.includes(name)) return [];
      const value = property.isObjectProperty()
        ? property.get('value')
        : property;
      const expression = direct ? value : getter(value);
      return expression ? [{ name, expression }] : [];
    });
  };
  traverse(parsed, {
    ExportNamedDeclaration(item) {
      if (!initialized(item)) return;
      const declaration = item.get('declaration');
      if (declaration?.isVariableDeclaration())
        for (const variable of declaration.get('declarations')) {
          const id = variable.get('id');
          if (id.isIdentifier() && exports.has(id.node.name))
            exports.get(id.node.name).push(id);
        }
      else if (
        declaration?.isFunctionDeclaration() &&
        exports.has(declaration.node.id?.name)
      )
        exports.get(declaration.node.id.name).push(declaration);
      for (const specifier of item.get('specifiers'))
        if (
          specifier.isExportSpecifier() &&
          exports.has(specifier.node.exported.name)
        )
          exports
            .get(specifier.node.exported.name)
            .push(specifier.get('local'));
    },
    AssignmentExpression(item) {
      if (item.node.operator !== '=' || !initialized(item)) return;
      const left = item.get('left');
      if (global(left, 'exports') || global(left, 'module'))
        reboundCommonJsGlobal = true;
      const name = memberName(left);
      if (exports.has(name) && global(left.get('object'), 'exports'))
        exports.get(name).push(item.get('right'));
      if (name === 'exports' && global(left.get('object'), 'module')) {
        const right = item.get('right');
        replacements.push(right);
        if (plainNamespace(right)) namespaces.push(right);
      }
    },
    CallExpression(item) {
      if (!initialized(item)) return;
      const callee = item.get('callee');
      const args = item.get('arguments');
      if (
        memberName(callee) === 'd' &&
        callee.get('object').isIdentifier() &&
        canonicalRuntime(callee.get('object'), item) &&
        args.length === 2 &&
        plainNamespace(args[0])
      ) {
        namespaceInitializations.add(args[0].node);
        for (const entry of objectExports(args[1]))
          tables.push({ object: args[0], ...entry });
      }
      if (
        memberName(callee) === 'r' &&
        args.length === 1 &&
        plainNamespace(args[0])
      ) {
        const matches = runtimeHelpers.filter(
          helper =>
            helper.name === 'r' &&
            sameReference(helper.runtime, callee.get('object')),
        );
        if (
          matches.length === 1 &&
          matches[0].canonical &&
          matches[0].path.node.start < item.node.start
        )
          namespaceInitializations.add(args[0].node);
      }
      if (
        memberName(callee) === 'defineProperty' &&
        global(callee.get('object'), 'Object') &&
        args.length === 3 &&
        args[1].isStringLiteral() &&
        names.includes(args[1].node.value) &&
        args[2].isObjectExpression()
      ) {
        const descriptor = args[2]
          .get('properties')
          .find(property => ['get', 'value'].includes(propertyName(property)));
        const value = descriptor?.isObjectProperty()
          ? descriptor.get('value')
          : descriptor;
        const expression =
          propertyName(descriptor ?? { node: {} }) === 'value'
            ? value
            : getter(value);
        if (expression) {
          if (global(args[0], 'exports'))
            exports.get(args[1].node.value).push(expression);
          else if (plainNamespace(args[0])) {
            namespaceInitializations.add(args[0].node);
            tables.push({
              object: args[0],
              name: args[1].node.value,
              expression,
            });
          }
        }
      }
    },
  });
  assert(
    !reboundCommonJsGlobal && replacements.length <= 1,
    `Native compiled server module has ambiguous CommonJS export replacement: ${file}`,
  );
  // The compiler getter installer deliberately keeps pre-existing properties.
  // Every use of its initially empty namespace must therefore be recognized
  // export wiring; a property write, alias, or unknown call invalidates it.
  const namespaceBindings = new Set(
    tables.map(table => table.object.scope.getBinding(table.object.node.name)),
  );
  for (const binding of namespaceBindings) {
    for (const reference of binding.referencePaths) {
      if (namespaceInitializations.has(reference.node)) continue;
      const parent = reference.parentPath;
      if (
        parent.isAssignmentExpression({ operator: '=' }) &&
        parent.get('right').node === reference.node &&
        memberName(parent.get('left')) === 'exports' &&
        global(parent.get('left.object'), 'module') &&
        initialized(parent)
      )
        continue;
      const name = memberName(parent);
      const assignment = parent.parentPath;
      if (
        names.includes(name) &&
        parent.get('object').node === reference.node &&
        assignment?.isAssignmentExpression({ operator: '=' }) &&
        assignment.get('right').node === parent.node &&
        memberName(assignment.get('left')) === name &&
        global(assignment.get('left.object'), 'exports') &&
        initialized(assignment)
      )
        continue;
      assert(
        false,
        `Native compiled server export namespace is mutated or escapes recognized compiler wiring: ${file}`,
      );
    }
  }
  if (replacements.length === 1) {
    for (const values of exports.values()) values.length = 0;
    for (const entry of objectExports(replacements[0], true))
      exports.get(entry.name).push(entry.expression);
  }
  for (const namespace of namespaces)
    for (const table of tables)
      if (sameReference(table.object, namespace))
        exports.get(table.name).push(table.expression);
  const resolve = (item, seen = new Set()) => {
    if (!item?.node || seen.has(item.node)) return undefined;
    seen.add(item.node);
    if (item.isIdentifier()) {
      const binding = item.scope.getBinding(item.node.name);
      if (!binding?.constant) return undefined;
      if (binding.path.isVariableDeclarator())
        return resolve(binding.path.get('init'), seen);
      if (binding.path.isFunctionDeclaration()) return binding.path;
    }
    if (
      item.isCallExpression() &&
      memberName(item.get('callee')) === 'freeze' &&
      global(item.get('callee.object'), 'Object') &&
      item.get('arguments').length === 1
    )
      return resolve(item.get('arguments')[0], seen);
    if (item.isMemberExpression()) {
      const matches = tables.filter(
        table =>
          table.name === memberName(item) &&
          sameReference(table.object, item.get('object')),
      );
      if (matches.length === 1) return resolve(matches[0].expression, seen);
    }
    return item;
  };
  const literal = item => {
    item = resolve(item);
    if (
      item?.isStringLiteral() ||
      item?.isNumericLiteral() ||
      item?.isBooleanLiteral()
    )
      return item.node.value;
    if (!item?.isObjectExpression()) return undefined;
    const value = {};
    for (const property of item.get('properties')) {
      const key = propertyName(property);
      if (
        !property.isObjectProperty() ||
        typeof key !== 'string' ||
        Object.hasOwn(value, key)
      )
        return undefined;
      const member = literal(property.get('value'));
      if (member === undefined) return undefined;
      value[key] = member;
    }
    return value;
  };
  for (const name of names) {
    const values = exports.get(name);
    assert(
      values.length === 1,
      `Native compiled server module requires one explicit ${name} export: ${file}`,
    );
    const expression = resolve(values[0]);
    if (name === 'rendererIdentity') {
      const value = literal(expression);
      assert(
        value &&
          Object.keys(value).length === Object.keys(identity).length &&
          Object.entries(identity).every(
            ([key, member]) => value[key] === member,
          ),
        `Native compiled server module identity conflicts with its finalized manifest: ${file}`,
      );
    } else
      assert(
        expression?.isFunctionDeclaration() ||
          expression?.isFunctionExpression() ||
          expression?.isArrowFunctionExpression(),
        `Native compiled server module has no statically bound ${name} function: ${file}`,
      );
  }
}

function within(root, file) {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function packageName(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

function forbiddenNativePackage(name, renderer) {
  const normalized = name.replace(/^@bleedingdev\/modern-js-/u, '@modern-js/');
  return (
    /^(?:react|react-dom|react-refresh|react-compiler-runtime|babel-plugin-react-compiler|react-router|react-router-dom|react-helmet(?:-async)?|react-i18next|react-server-dom-[^/]+)$/u.test(
      normalized,
    ) ||
    /^@(?:types\/(?:react|react-dom)|tanstack\/react-(?:router|start)|rsbuild\/plugin-react|rspack\/plugin-react-refresh)$/u.test(
      normalized,
    ) ||
    /^@babel\/(?:preset-react|plugin-(?:transform|syntax)-react-[^/]+)$/u.test(
      normalized,
    ) ||
    /^@modern-js\/(?:plugin-rsc|plugin-runtime|plugin-react|renderer-react)$/u.test(
      normalized,
    ) ||
    (renderer === 'octane' && name === '@tanstack/solid-router') ||
    (renderer === 'solid' && name === '@octanejs/tanstack-router')
  );
}

function manifestFacts(manifest) {
  return {
    name: manifest.name,
    version: manifest.version,
    exports: manifest.exports ?? null,
    engines: manifest.engines ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    peerDependenciesMeta: manifest.peerDependenciesMeta ?? {},
  };
}

function exportedPaths(value, trail = [], result = []) {
  if (typeof value === 'string')
    result.push({ conditions: trail, target: value });
  else if (Array.isArray(value))
    value.forEach((item, index) =>
      exportedPaths(item, [...trail, String(index)], result),
    );
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value))
      exportedPaths(item, [...trail, key], result);
  }
  return result;
}

function auditExportFiles(manifest, files) {
  const targets = exportedPaths(manifest.exports);
  for (const field of ['main', 'module', 'types', 'typings']) {
    if (typeof manifest[field] === 'string' && manifest[field] !== '')
      targets.push({
        conditions: [field],
        target: manifest[field],
        legacy: true,
      });
  }
  for (const { conditions, target, legacy } of targets) {
    assert(
      !conditions.includes('modern:source'),
      `${manifest.name} still publishes modern:source`,
    );
    assert(
      !path.posix.isAbsolute(target) &&
        !target.includes('\\') &&
        !target
          .split('/')
          .some(segment => ['..', 'node_modules'].includes(segment)) &&
        !/%(?:2e|2f|5c)/iu.test(target) &&
        (legacy || target.startsWith('./')),
      `${manifest.name} has unsafe export target ${target}`,
    );
    const relative = target.replace(/^\.\//u, '');
    const parts = relative.split('*');
    const escapePattern = value =>
      value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern =
      parts.length === 1
        ? undefined
        : new RegExp(
            `^${parts.map((part, index) => `${index === 0 ? '' : index === 1 ? '(.*)' : '\\1'}${escapePattern(part)}`).join('')}$`,
            'u',
          );
    const matches = pattern
      ? files.some(file => pattern.test(file))
      : files.includes(relative);
    assert(
      matches,
      `${manifest.name} export ${conditions.join('.')} is missing ${target}`,
    );
  }
  return targets;
}

/** Validates strict immutable release evidence and reads the packed manifests. */
export function auditReleaseArtifacts({
  manifestPath,
  expectedSourceRevision,
}) {
  const release = readReleaseManifest({ manifestPath });
  if (expectedSourceRevision !== undefined) {
    assert(
      release.source.commit === expectedSourceRevision,
      `Release source revision ${release.source.commit} differs from ${expectedSourceRevision}`,
    );
  }
  const artifacts = release.packages
    .map(item => {
      assert(
        item.targetName ===
          `@bleedingdev/modern-js-${item.sourceName.slice('@modern-js/'.length)}`,
        `Unsupported public publication mapping ${item.sourceName} -> ${item.targetName}`,
      );
      const bytes = readVerifiedPackageArtifactBytes(item, item.artifactPath);
      const inspection = inspectNpmTarball(bytes);
      const exportTargets = auditExportFiles(
        inspection.packageJson,
        inspection.files.map(file => file.path),
      );
      return {
        sourceName: item.sourceName,
        targetName: item.targetName,
        version: item.version,
        path: item.artifactPath,
        sha256: item.sha256,
        integrity: item.integrity,
        shasum: item.shasum,
        packageJsonSha256: item.packageJsonSha256,
        fileListSha256: item.fileListSha256,
        fileCount: inspection.fileCount,
        unpackedSize: inspection.unpackedSize,
        size: bytes.length,
        files: inspection.files.map(file => ({
          ...file,
          sha256: crypto
            .createHash('sha256')
            .update(inspection.fileContents.get(file.path))
            .digest('hex'),
        })),
        ...manifestFacts(inspection.packageJson),
        dependencies: inspection.packageJson.dependencies ?? {},
        optionalDependencies: inspection.packageJson.optionalDependencies ?? {},
        exportTargets,
      };
    })
    .sort((left, right) => left.targetName.localeCompare(right.targetName));
  return {
    manifestPath: path.resolve(manifestPath),
    sourceRevision: release.source.commit,
    source: release.source,
    release: release.release,
    manifestSha256: release.manifestSha256,
    cohortDigest: release.cohortDigest,
    aliases: release.aliases,
    dependencyGraph: release.dependencyGraph,
    artifacts,
    sidecars:
      release.sidecars?.packages.map(item => {
        const inspection = inspectNpmTarball(item.bytes);
        return {
          ...manifestFacts(inspection.packageJson),
          path: item.artifactPath,
          sha256: item.sha256,
          integrity: item.integrity,
          dependencies: inspection.packageJson.dependencies ?? {},
          optionalDependencies:
            inspection.packageJson.optionalDependencies ?? {},
          files: inspection.files.map(file => ({
            ...file,
            sha256: crypto
              .createHash('sha256')
              .update(inspection.fileContents.get(file.path))
              .digest('hex'),
          })),
        };
      }) ?? [],
  };
}

function installedPackage(name, fromDirectory, consumerRoot) {
  const require = createRequire(path.join(fromDirectory, 'package.json'));
  // Declared npm dependencies require a physical package even when Node has a
  // builtin with the same bare name, whose resolve.paths result would be null.
  for (const directory of require.resolve.paths(`${name}/package.json`) ?? []) {
    const candidate = path.join(directory, name);
    if (!fs.existsSync(path.join(candidate, 'package.json'))) continue;
    const realDirectory = fs.realpathSync(candidate);
    assert(
      within(consumerRoot, realDirectory),
      `Installed package ${name} resolves outside the clean consumer: ${realDirectory}`,
    );
    const manifestPath = path.join(realDirectory, 'package.json');
    const bytes = fs.readFileSync(manifestPath);
    const manifest = JSON.parse(bytes.toString('utf8'));
    assert(
      typeof manifest.name === 'string' && exactVersion.test(manifest.version),
      `Invalid installed package identity for ${name}`,
    );
    return {
      directory: realDirectory,
      manifest,
      manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  }
  return undefined;
}

function dependencyEdges(manifest) {
  const edges = new Map();
  for (const [name, specifier] of Object.entries(manifest.dependencies ?? {}))
    edges.set(name, {
      name,
      specifier,
      optional: false,
      block: 'dependencies',
    });
  for (const [name, specifier] of Object.entries(
    manifest.optionalDependencies ?? {},
  ))
    edges.set(name, {
      name,
      specifier,
      optional: true,
      block: 'optionalDependencies',
    });
  for (const [name, specifier] of Object.entries(
    manifest.peerDependencies ?? {},
  )) {
    if (!edges.has(name))
      edges.set(name, {
        name,
        specifier,
        optional: manifest.peerDependenciesMeta?.[name]?.optional === true,
        block: 'peerDependencies',
      });
  }
  return [...edges.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function exportedEntry(manifest, specifier, conditions) {
  const name = packageName(specifier);
  const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
  let value = manifest.exports;
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).some(key => key.startsWith('.'))
  ) {
    if (Object.hasOwn(value, subpath)) value = value[subpath];
    else {
      const match = Object.keys(value)
        .filter(key => key.includes('*'))
        .sort(
          (left, right) =>
            right.indexOf('*') - left.indexOf('*') ||
            right.length - left.length,
        )
        .find(
          key =>
            subpath.startsWith(key.split('*')[0]) &&
            subpath.endsWith(key.split('*')[1]),
        );
      if (!match) return undefined;
      const [prefix, suffix] = match.split('*');
      const replacement = subpath.slice(
        prefix.length,
        suffix.length ? -suffix.length : undefined,
      );
      const substitute = item =>
        typeof item === 'string'
          ? item.replaceAll('*', replacement)
          : Array.isArray(item)
            ? item.map(substitute)
            : item && typeof item === 'object'
              ? Object.fromEntries(
                  Object.entries(item).map(([key, child]) => [
                    key,
                    substitute(child),
                  ]),
                )
              : item;
      value = substitute(value[match]);
    }
  } else if (manifest.exports !== undefined && subpath !== '.')
    return undefined;
  const select = item => {
    if (item === null) return null;
    if (typeof item === 'string') return item;
    if (Array.isArray(item))
      return item.map(select).find(value => value !== undefined);
    if (item && typeof item === 'object') {
      for (const [condition, child] of Object.entries(item)) {
        if (condition === 'default' || conditions.has(condition)) {
          const selected = select(child);
          if (selected !== undefined) return selected;
        }
      }
    }
    return undefined;
  };
  if (manifest.exports !== undefined) return select(value);
  if (conditions.has('types') && subpath === '.')
    return manifest.types ?? manifest.typings;
  return subpath === '.'
    ? (manifest.module ?? manifest.main ?? 'index.js')
    : subpath;
}

function resolveFile(candidate, { exact = false, beforeRealpath } = {}) {
  const resolved = file => {
    beforeRealpath?.(file);
    return fs.realpathSync(file);
  };
  if (exact)
    return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()
      ? resolved(candidate)
      : undefined;
  for (const extension of extensions) {
    const file = `${candidate}${extension}`;
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      return resolved(file);
  }
  for (const extension of extensions.slice(1)) {
    const file = path.join(candidate, `index${extension}`);
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      return resolved(file);
  }
  return undefined;
}

function resolveTypeFile(candidate, { beforeRealpath } = {}) {
  const extension = path.extname(candidate);
  const suffixes =
    extension === '.mjs'
      ? ['.d.mts', '.mts']
      : extension === '.cjs'
        ? ['.d.cts', '.cts']
        : ['.d.ts', '.ts', '.tsx'];
  const stem = /\.(?:[cm]?js|jsx)$/u.test(candidate)
    ? candidate.slice(0, -extension.length)
    : candidate;
  for (const suffix of suffixes) {
    const resolved = resolveFile(`${stem}${suffix}`, {
      exact: true,
      beforeRealpath,
    });
    if (resolved) return resolved;
  }
  return resolveFile(candidate, { beforeRealpath });
}

/** Runtime imports are source-strict; host build inputs join their actual build. */
export function auditInstalledConsumer({
  consumerRoot,
  applicationRoot = '.',
  renderer,
  exactPackages,
  entryFiles,
  buildEntryFiles = [],
  buildCommandEvidence,
  testedProfile,
  releaseArtifacts,
  nativeCompilerManifests,
  rendererBuildManifestPath,
  rendererBuildEvidence,
  rendererDevelopmentManifestPath,
}) {
  assert(renderers.has(renderer), `Unknown renderer ${String(renderer)}`);
  assert(
    exactPackages &&
      typeof exactPackages === 'object' &&
      !Array.isArray(exactPackages) &&
      Object.keys(exactPackages).length > 0,
    'An explicit exact installed package tuple is required',
  );
  for (const [name, version] of Object.entries(exactPackages))
    assert(
      exactVersion.test(version),
      `Tested tuple ${name} must use an exact version`,
    );
  assert(
    Array.isArray(entryFiles) && entryFiles.length > 0,
    'Source and emitted entry files are required',
  );
  assert(
    Array.isArray(buildEntryFiles),
    'Host build entries must be an explicit observed file list',
  );
  const root = fs.realpathSync(consumerRoot);
  let producer;
  if (releaseArtifacts !== undefined) {
    assert(
      typeof releaseArtifacts?.manifestPath === 'string',
      'Producer release artifacts must come from an audited release manifest',
    );
    producer = auditReleaseArtifacts({
      manifestPath: releaseArtifacts.manifestPath,
      expectedSourceRevision: releaseArtifacts.sourceRevision,
    });
    for (const field of ['sourceRevision', 'manifestSha256', 'cohortDigest'])
      assert(
        releaseArtifacts[field] === producer[field],
        `Producer release ${field} differs from its actual manifest`,
      );
  }
  const producerPackages = new Map(
    producer?.artifacts.map(artifact => [artifact.name, artifact]) ?? [],
  );
  const producerSidecars = new Map(
    producer?.sidecars.map(artifact => [artifact.name, artifact]) ?? [],
  );
  const producerArtifactBindings = [];
  const producerSidecarBindings = [];
  const authenticatedAliases = new Map();
  for (const artifact of [
    ...(producer?.artifacts ?? []),
    ...(producer?.sidecars ?? []),
  ]) {
    for (const block of ['dependencies', 'optionalDependencies']) {
      for (const [name, specifier] of Object.entries(artifact[block] ?? {})) {
        const alias = /^npm:(@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(specifier);
        const target =
          producerPackages.get(alias?.[1]) ?? producerSidecars.get(alias?.[1]);
        if (!target) continue;
        assert(
          exactVersion.test(alias[2]) && alias[2] === target.version,
          `Authenticated archive alias ${name} differs from its target version`,
        );
        const previous = authenticatedAliases.get(name);
        assert(
          !previous || previous.specifier === specifier,
          `Conflicting authenticated archive alias ${name}`,
        );
        const binding = previous ?? {
          name,
          specifier,
          targetName: target.name,
          version: target.version,
          declarations: [],
        };
        binding.declarations.push({
          owner: artifact.name,
          ownerVersion: artifact.version,
          artifactSha256: artifact.sha256,
          block,
        });
        authenticatedAliases.set(name, binding);
      }
    }
  }
  // Authenticate before invoking any installed owning validator. The ordinary
  // final inventory below repeats this check after the selected source scan.
  const authenticateProducerPackage = record => {
    const artifact = producerPackages.get(record.manifest.name);
    assert(
      artifact && artifact.version === record.manifest.version,
      `Native server loader owner ${record.manifest.name} is outside the producer artifact cohort`,
    );
    const expected = new Map(artifact.files.map(file => [file.path, file]));
    const visit = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' && entry.isDirectory()) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else {
          assert(
            entry.isFile(),
            'Native server loader package contains a non-regular packed file',
          );
          const relative = path
            .relative(record.directory, file)
            .split(path.sep)
            .join('/');
          const fact = expected.get(relative);
          const bytes = fs.readFileSync(file);
          assert(
            fact &&
              fact.size === bytes.length &&
              fact.sha256 ===
                crypto.createHash('sha256').update(bytes).digest('hex'),
            `Native server loader package differs from candidate artifact bytes at ${relative}`,
          );
          expected.delete(relative);
        }
      }
    };
    visit(record.directory);
    assert(
      expected.size === 0,
      'Native server loader package is missing candidate artifact files',
    );
    return artifact;
  };
  assert(
    typeof applicationRoot === 'string' && !path.isAbsolute(applicationRoot),
    'applicationRoot must be relative to the clean consumer',
  );
  const appRoot = fs.realpathSync(path.resolve(root, applicationRoot));
  assert(within(root, appRoot), 'applicationRoot escapes the clean consumer');
  const contexts = [appRoot, ...(appRoot === root ? [] : [root])].map(
    directory => {
      const manifestPath = path.join(directory, 'package.json');
      assert(
        fs.lstatSync(manifestPath).isFile() &&
          fs.realpathSync(manifestPath) === manifestPath,
        'Consumer context requires an ordinary canonical package manifest',
      );
      const bytes = fs.readFileSync(manifestPath);
      return {
        directory,
        manifest: JSON.parse(bytes),
        manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    },
  );
  const application = contexts[0].manifest;
  const workspace = contexts.find(
    context => context.directory === root,
  ).manifest;
  const native = renderer !== 'react';
  if (native)
    for (const name of ['react', 'react-dom'])
      assert(
        !installedPackage(name, appRoot, root),
        `${renderer} consumer resolves a forbidden React/RSC runtime package ${name}`,
      );
  const records = new Map();
  const reachability = new Map();
  const edges = [];
  const queue = [];
  const missingOptional = [];
  const authoringMissingOptional = [];
  const authoringRoots = [];
  const catalogBindings = new Map();
  const workspaceAliasBindings = new Map();
  let workspaceCatalog;
  const readWorkspace = () => {
    if (workspaceCatalog) return workspaceCatalog;
    const file = path.join(root, 'pnpm-workspace.yaml');
    assert(
      fs.lstatSync(file).isFile() && within(root, fs.realpathSync(file)),
      'Dependency aliases require the ordinary owning workspace manifest',
    );
    const bytes = fs.readFileSync(file);
    const document = parseDocument(bytes.toString('utf8'), {
      uniqueKeys: true,
    });
    assert(
      document.errors.length === 0,
      'Invalid owning workspace manifest or catalog',
    );
    workspaceCatalog = {
      value: document.toJS({ maxAliasCount: 0 }),
      path: path.relative(root, file),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
    return workspaceCatalog;
  };
  const resolveCatalogSpecifier = (name, specifier, ownerDirectory) => {
    if (!String(specifier).startsWith('catalog:')) return { specifier };
    assert(
      contexts.some(context => context.directory === ownerDirectory),
      `Installed package ${name} leaks an unresolved catalog dependency`,
    );
    const catalog = /^catalog:([^:\s]*)$/u.exec(specifier)?.[1];
    assert(catalog !== undefined, `Invalid catalog dependency ${name}`);
    readWorkspace();
    const entries = catalog
      ? workspaceCatalog.value?.catalogs?.[catalog]
      : workspaceCatalog.value?.catalog;
    assert(
      entries &&
        Object.hasOwn(entries, name) &&
        typeof entries[name] === 'string',
      `Missing owning catalog ${catalog || 'default'} dependency ${name}`,
    );
    const resolved = entries[name];
    const alias = /^npm:(@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(resolved);
    assert(
      exactVersion.test(alias?.[2] ?? resolved),
      `Catalog ${name} must resolve an exact installed package version`,
    );
    const binding = {
      name,
      catalog: catalog || 'default',
      declaredSpecifier: specifier,
      resolvedSpecifier: resolved,
      workspaceFile: workspaceCatalog.path,
      workspaceSha256: workspaceCatalog.sha256,
    };
    catalogBindings.set(`${catalog}:${name}`, binding);
    return { specifier: resolved, catalogBinding: binding };
  };
  const resolveSpecifier = (name, specifier, ownerDirectory) => {
    const resolved = resolveCatalogSpecifier(name, specifier, ownerDirectory);
    if (!fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))) return resolved;
    const workspace = readWorkspace();
    const overrides = workspace.value?.overrides;
    if (!overrides || !Object.hasOwn(overrides, name)) return resolved;
    const override = overrides[name];
    const authority = authenticatedAliases.get(name);
    // An identical explicit declaration already carries its alias authority;
    // only a changed effective identity needs the archive-backed override proof.
    if (!authority && override === resolved.specifier) return resolved;
    if (!authority && !String(override).startsWith('npm:')) return resolved;
    assert(
      authority,
      `Workspace alias ${name} has no authenticated archive declaration`,
    );
    assert(
      override === authority.specifier,
      `Workspace alias ${name} differs from its authenticated archive declaration`,
    );
    assert(
      !Object.keys(overrides).some(
        key => key.includes('>') || key.startsWith(`${name}@`),
      ),
      `Workspace alias ${name} requires an unambiguous exact global override`,
    );
    const declaredAlias = /^npm:(@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(
      resolved.specifier,
    );
    assert(
      !declaredAlias || resolved.specifier === authority.specifier,
      `Declared alias ${name} conflicts with its authenticated workspace alias`,
    );
    const binding = {
      ...authority,
      workspaceFile: workspace.path,
      workspaceSha256: workspace.sha256,
    };
    workspaceAliasBindings.set(name, binding);
    return {
      ...resolved,
      declaredSpecifier: resolved.specifier,
      specifier: override,
      workspaceAliasBinding: binding,
    };
  };
  const canonicalFrameworkIdentity = name =>
    name.startsWith('@modern-js/')
      ? `@bleedingdev/modern-js-${name.slice('@modern-js/'.length)}`
      : name.startsWith('@bleedingdev/modern-js-')
        ? name
        : undefined;
  const assertFrameworkAlias = (name, alias) => {
    if (!alias) return;
    const expected = canonicalFrameworkIdentity(name);
    if (expected)
      assert(
        alias[1] === expected,
        `Framework alias ${name} must resolve its canonical mapped identity ${expected}`,
      );
  };
  const permittedTypeDependencies = new Map();
  const permittedTypeImports = [];
  const permittedReactDeclarationFiles = new Set();
  const authenticatedDeclarationFiles = new Map();
  const authenticatedTypeEdges = [];
  let octaneTypeEvidence;
  const typeEvidence = () => (octaneTypeEvidence ??= readOctaneTypeEvidence());
  const nativeTypeOwner = record =>
    renderer === 'octane' &&
    record?.manifest.name === 'octane' &&
    record.manifest.version === typeEvidence().declaredScope.providerVersion;
  const authenticateDeclaration = (record, packagePath) => {
    const expected = [
      ...typeEvidence().nativeFiles,
      ...typeEvidence().reactFiles,
    ].find(item => item.packagePath === packagePath);
    assert(
      expected && packagePath.startsWith(`${record.manifest.name}/`),
      `No authenticated Octane type declaration ${packagePath}`,
    );
    const file = resolveFile(
      path.join(
        record.directory,
        packagePath.slice(record.manifest.name.length + 1),
      ),
      { exact: true },
    );
    assert(
      file && within(root, file) && within(record.directory, file),
      `Missing or external authenticated Octane type declaration ${packagePath}`,
    );
    const bytes = fs.readFileSync(file);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    assert(
      bytes.length === expected.size && sha256 === expected.sha256,
      `Octane native type declaration differs from authenticated bytes: ${packagePath}`,
    );
    const fact = {
      packagePath,
      path: path.relative(root, file),
      owner: record.manifest.name,
      ownerVersion: record.manifest.version,
      sha256,
      size: bytes.length,
    };
    authenticatedDeclarationFiles.set(file, fact);
    return { file, fact };
  };
  const permittedDeclarationPackage = name =>
    renderer === 'octane' && name === '@types/react';
  const add = (record, scope = 'native') => {
    if (!records.has(record.directory)) {
      records.set(record.directory, record);
    }
    const scopes = reachability.get(record.directory) ?? new Set();
    if (!scopes.has(scope)) {
      scopes.add(scope);
      reachability.set(record.directory, scopes);
      queue.push({ record, scope });
    }
    if (native && scope === 'native')
      assert(
        !forbiddenNativePackage(record.manifest.name, renderer) ||
          permittedDeclarationPackage(record.manifest.name),
        `${renderer} consumer contains forbidden React/RSC package ${record.manifest.name}`,
      );
    if (
      renderer === 'octane' &&
      scope === 'native' &&
      record.manifest.name === 'octane'
    )
      for (const name of ['react', 'react-dom'])
        assert(
          !installedPackage(name, record.directory, root),
          `octane@${record.manifest.version} resolves a forbidden React/RSC runtime package ${name}`,
        );
    if (scope === 'native' && nativeTypeOwner(record)) {
      assert(
        typeof record.manifest.dependencies?.['@types/react'] === 'string',
        'Octane native type interop requires its owned production declaration dependency',
      );
      for (const file of typeEvidence().nativeFiles)
        authenticateDeclaration(record, file.packagePath);
    }
    if (
      scope === 'native' &&
      permittedDeclarationPackage(record.manifest.name)
    ) {
      assert(
        record.manifest.version ===
          typeEvidence().declaredScope.reactTypesVersion,
        'Octane React declarations must use the exact authenticated @types/react identity',
      );
      const targets = [
        ...exportedPaths(record.manifest.exports).map(item => item.target),
        record.manifest.types,
        record.manifest.typings,
      ].filter(target => target !== undefined);
      assert(
        !record.manifest.main &&
          !record.manifest.module &&
          targets.length > 0 &&
          targets.every(
            target =>
              typeof target === 'string' &&
              (/\.d\.[cm]?ts$/u.test(target) || target === './package.json'),
          ),
        'Octane permits @types/react declarations only; its installed manifest exposes a runtime entry',
      );
      permittedTypeDependencies.set(record.directory, {
        name: record.manifest.name,
        version: record.manifest.version,
        path: path.relative(root, record.directory),
        manifestSha256: record.manifestSha256,
        reason: 'octane-native-authored-jsx-type-interop',
        evidenceSha256: octaneTypeEvidenceSha256,
        files: typeEvidence().reactFiles.map(
          file => authenticateDeclaration(record, file.packagePath).fact,
        ),
      });
    }
    return record;
  };
  const resolveEdge = (edge, owner, scope = 'native') => {
    const resolved = resolveSpecifier(
      edge.name,
      edge.specifier,
      owner.directory,
    );
    const scopedMissing =
      scope === 'native' ? missingOptional : authoringMissingOptional;
    const record = installedPackage(edge.name, owner.directory, root);
    const absentOctaneCompatibilityPeer =
      renderer === 'octane' &&
      owner.manifest.name === 'octane' &&
      edge.block === 'peerDependencies' &&
      edge.optional &&
      ['react', 'react-dom'].includes(edge.name) &&
      !record;
    if (!record && edge.block === 'peerDependencies' && edge.optional) {
      scopedMissing.push({
        from: owner.manifest.name,
        name: edge.name,
        block: edge.block,
        reason: absentOctaneCompatibilityPeer
          ? 'octane-compatibility-export-peer-absent'
          : 'optional-peer-absent',
      });
      return;
    }
    if (native && scope === 'native')
      assert(
        !forbiddenNativePackage(edge.name, renderer) ||
          (permittedDeclarationPackage(edge.name) &&
            nativeTypeOwner(owner) &&
            edge.block === 'dependencies'),
        `${renderer} consumer declares forbidden React/RSC dependency ${edge.name}`,
      );
    if (
      native &&
      scope === 'native' &&
      permittedDeclarationPackage(edge.name) &&
      nativeTypeOwner(owner) &&
      edge.block === 'dependencies'
    )
      assert(
        record?.manifest.name === '@types/react' &&
          record.manifest.version ===
            typeEvidence().declaredScope.reactTypesVersion,
        'Octane production declaration dependency must resolve the exact authenticated @types/react identity',
      );
    if (!record) {
      assert(
        edge.optional,
        `Missing installed ${edge.block} ${edge.name} from ${owner.manifest.name}`,
      );
      scopedMissing.push({
        from: owner.manifest.name,
        name: edge.name,
      });
      return;
    }
    const alias = /^npm:(@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(resolved.specifier);
    assertFrameworkAlias(edge.name, alias);
    const mappedPeer =
      edge.block === 'peerDependencies' && edge.name.startsWith('@modern-js/')
        ? `@bleedingdev/modern-js-${edge.name.slice('@modern-js/'.length)}`
        : undefined;
    assert(
      record.manifest.name === (alias?.[1] ?? edge.name) ||
        (!alias && record.manifest.name === mappedPeer),
      `Installed identity mismatch for ${edge.name}: ${record.manifest.name}`,
    );
    const version = alias?.[2] ?? resolved.specifier;
    const declaredVersion =
      /^npm:(@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(
        resolved.declaredSpecifier,
      )?.[2] ?? resolved.declaredSpecifier;
    if (exactVersion.test(declaredVersion ?? ''))
      assert(
        record.manifest.version === declaredVersion,
        `Installed ${edge.name} version ${record.manifest.version} differs from declared ${declaredVersion}`,
      );
    if (exactVersion.test(version))
      assert(
        record.manifest.version === version,
        `Installed ${edge.name} version ${record.manifest.version} differs from ${version}`,
      );
    if (
      native &&
      edge.block === 'peerDependencies' &&
      /\d+\.\d+\.\d+-/u.test(version)
    )
      assert(
        exactVersion.test(version),
        `${renderer} prerelease peer ${edge.name} must be exact: ${version}`,
      );
    edges.push({
      from: owner.manifest.name,
      name: edge.name,
      installedName: record.manifest.name,
      version: record.manifest.version,
      block: edge.block,
      scope,
      fromPath: path.relative(root, owner.directory),
      installedPath: path.relative(root, record.directory),
      ...(resolved.workspaceAliasBinding
        ? {
            declaredSpecifier: edge.specifier,
            resolvedSpecifier: resolved.specifier,
            workspaceAliasBinding: resolved.workspaceAliasBinding,
          }
        : {}),
      ...(resolved.catalogBinding
        ? { catalogBinding: resolved.catalogBinding }
        : {}),
    });
    add(record, scope);
    return record;
  };
  const drain = () => {
    while (queue.length) {
      const { record, scope } = queue.shift();
      for (const edge of dependencyEdges(record.manifest))
        resolveEdge(edge, record, scope);
    }
  };
  for (const context of contexts)
    for (const edge of dependencyEdges(context.manifest))
      resolveEdge(edge, context);
  if (native)
    for (const context of contexts)
      for (const [name, specifier] of Object.entries(
        context.manifest.devDependencies ?? {},
      )) {
        const declaredGenerator = [
          '@modern-js/ultramodern-create',
          '@bleedingdev/modern-js-ultramodern-create',
        ].includes(name);
        const astAlias =
          name === '@typescript/native' &&
          resolveSpecifier(name, specifier, context.directory).specifier ===
            'npm:typescript@7.0.2';
        const authoring =
          context.directory === root &&
          appRoot !== root &&
          (declaredGenerator || astAlias);
        const record = resolveEdge(
          { name, specifier, optional: false, block: 'devDependencies' },
          context,
          authoring ? 'authoring' : 'native',
        );
        if (authoring) {
          assert(
            astAlias
              ? record?.manifest.name === 'typescript' &&
                  record.manifest.version === '7.0.2'
              : record?.manifest.name ===
                  '@bleedingdev/modern-js-ultramodern-create',
            'Root authoring input must have its actual exact installed identity',
          );
          authoringRoots.push({
            installationName: name,
            qualification: astAlias
              ? 'typescript-native-ast-exact-alias'
              : 'mapped-generator-root-dev-only',
            name: record.manifest.name,
            version: record.manifest.version,
            path: path.relative(root, record.directory),
            block: 'devDependencies',
            workspaceRoot: '.',
            manifestSha256: record.manifestSha256,
          });
        }
      }
  drain();
  const astAuthoringRoot = authoringRoots.find(
    item => item.qualification === 'typescript-native-ast-exact-alias',
  );
  if (astAuthoringRoot) {
    const generatorRoot = authoringRoots.find(
      item => item.qualification === 'mapped-generator-root-dev-only',
    );
    assert(
      generatorRoot,
      'The exact AST authoring alias requires its owning mapped workspace generator',
    );
    const generatorDirectory = path.resolve(root, generatorRoot.path);
    const astDirectory = path.resolve(root, astAuthoringRoot.path);
    const specifiers = [
      '@typescript/native/unstable/ast',
      '@typescript/native/unstable/sync',
    ];
    const usage = [];
    for (const relative of [
      'dist/esm-node/ultramodern-workspace/validation/architecture.js',
      'dist/cjs/ultramodern-workspace/validation/architecture.cjs',
      'dist/cjs/ultramodern-workspace/validation/architecture.js',
    ]) {
      const file = resolveFile(path.join(generatorDirectory, relative), {
        exact: true,
      });
      if (!file) continue;
      assert(
        within(generatorDirectory, file),
        'Installed architecture validator escapes its owning generator',
      );
      const bytes = fs.readFileSync(file);
      const imports = moduleSpecifiers(
        bytes.toString('utf8'),
        file,
        new Set(['workspaceRequire']),
      );
      if (
        specifiers.every(specifier =>
          imports.some(item => item.require && item.specifier === specifier),
        )
      )
        usage.push({
          owner: generatorRoot.name,
          ownerVersion: generatorRoot.version,
          path: path.relative(root, file),
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          specifiers,
        });
    }
    assert(
      usage.length > 0,
      'The exact AST authoring alias requires actual installed validator references to both public AST exports',
    );
    const workspaceRequire = createRequire(path.join(root, 'package.json'));
    astAuthoringRoot.usage = usage;
    astAuthoringRoot.exportBindings = specifiers.map(specifier => {
      const file = fs.realpathSync(workspaceRequire.resolve(specifier));
      assert(
        within(astDirectory, file) && within(root, file),
        'AST authoring export must resolve inside its exact installed TypeScript7 package',
      );
      return {
        specifier,
        path: path.relative(root, file),
        sha256: crypto
          .createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex'),
      };
    });
    astAuthoringRoot.executionGate =
      'owning-generated-workspace-architecture-validator';
  }
  const blocks = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ];
  const direct = contexts
    .flatMap(context =>
      [
        ...new Set(
          blocks.flatMap(block => Object.keys(context.manifest[block] ?? {})),
        ),
      ].map(name => ({
        name,
        context,
        record: installedPackage(name, context.directory, root),
      })),
    )
    .filter(item => item.record);
  const tupleIdentities = new Map();
  for (const [name, version] of Object.entries(exactPackages)) {
    const matches = direct.filter(
      item =>
        (item.name === name || item.record.manifest.name === name) &&
        reachability.get(item.record.directory)?.has('native'),
    );
    for (const record of records.values())
      if (
        record.manifest.name === name &&
        reachability.get(record.directory)?.has('native') &&
        !matches.some(item => item.record.directory === record.directory)
      )
        matches.push({ name, record });
    assert(
      matches.length > 0,
      `Tested tuple package ${name} is not installed in the consumer closure`,
    );
    const identities = new Set();
    for (const { name: installationName, context, record } of matches) {
      const specifier = blocks
        .map(block => context?.manifest[block]?.[installationName])
        .find(value => value !== undefined);
      const resolved = context
        ? resolveSpecifier(installationName, specifier, context.directory)
            .specifier
        : specifier;
      const alias = /^npm:(@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(resolved);
      assertFrameworkAlias(installationName, alias);
      assert(
        record.manifest.name === (alias?.[1] ?? installationName),
        `Tested tuple ${name} installed identity differs from ${alias?.[1] ?? installationName}`,
      );
      assert(
        record.manifest.version === version,
        `Tested tuple ${name} expected ${version}, installed ${record.manifest.version}`,
      );
      identities.add(record.manifest.name);
      add(record);
    }
    tupleIdentities.set(name, identities);
  }
  drain();
  if (testedProfile !== undefined) {
    assert(
      testedProfile?.renderer === renderer &&
        testedProfile.packages &&
        typeof testedProfile.packages === 'object' &&
        !Array.isArray(testedProfile.packages) &&
        Object.keys(testedProfile.packages).length > 0,
      'Tested profile must identify the selected renderer and its exact packages',
    );
    for (const [name, version] of Object.entries(testedProfile.packages))
      assert(
        exactVersion.test(version) && exactPackages[name] === version,
        `Tested profile package ${name} differs from the consumer tuple`,
      );
  }
  const nativeCompilerProofs = [];
  const nativeSourceModules = new Map();
  const nativeEmittedEntries = [];
  if (nativeCompilerManifests !== undefined) {
    assert(
      renderer === 'octane' &&
        Array.isArray(nativeCompilerManifests) &&
        nativeCompilerManifests.length > 0,
      'Native compiler manifests require a nonempty Octane manifest set',
    );
    assert(
      exactPackages.octane === typeEvidence().declaredScope.providerVersion &&
        exactPackages['@octanejs/rspack-plugin'] === '0.1.55',
      `Octane compiler provenance requires the exact tested octane@${typeEvidence().declaredScope.providerVersion} and @octanejs/rspack-plugin@0.1.55 tuple`,
    );
    const require = createRequire(path.join(appRoot, 'package.json'));
    const validatorTargetName = '@bleedingdev/modern-js-renderer-octane';
    const validatorInstallation = [
      validatorTargetName,
      '@modern-js/renderer-octane',
    ]
      .map(name => ({ name, record: installedPackage(name, appRoot, root) }))
      .find(item => item.record?.manifest.name === validatorTargetName);
    assert(
      validatorInstallation,
      'Octane provenance validator must be the mapped renderer package or its actual source-name alias',
    );
    const validatorPackage = validatorInstallation.record;
    const validatorPath = fs.realpathSync(
      require.resolve(`${validatorInstallation.name}/manifest`),
    );
    assert(
      within(root, validatorPath),
      'Octane manifest validator resolves outside the clean consumer',
    );
    const { validateOctaneModuleManifest } = require(validatorPath);
    assert(
      typeof validateOctaneModuleManifest === 'function',
      'Installed Octane renderer has no public module-manifest validator',
    );
    add(validatorPackage);
    nativeEmittedEntries.push(validatorPath);
    for (const input of nativeCompilerManifests) {
      assert(
        typeof input?.manifestPath === 'string' &&
          !path.isAbsolute(input.manifestPath) &&
          input.rendererIdentity?.renderer === 'octane',
        'Native compiler manifest requires a consumer-relative path and the actual application renderer identity',
      );
      const manifestPath = resolveFile(path.resolve(root, input.manifestPath), {
        exact: true,
      });
      assert(
        manifestPath && within(root, manifestPath),
        `Missing or external native compiler manifest ${input.manifestPath}`,
      );
      const outputRoot = path.dirname(manifestPath);
      const clientBuildPath = resolveFile(
        path.join(outputRoot, 'octane-client-build.json'),
        { exact: true },
      );
      assert(
        clientBuildPath && within(root, clientBuildPath),
        'Octane module provenance requires actual adjacent client build metadata',
      );
      const clientBytes = fs.readFileSync(clientBuildPath);
      const clientBuild = JSON.parse(clientBytes.toString('utf8'));
      assert(
        clientBuild.version === 1 && typeof clientBuild.buildId === 'string',
        'Invalid owning Octane client build metadata',
      );
      const manifestBytes = fs.readFileSync(manifestPath);
      const manifest = validateOctaneModuleManifest(
        JSON.parse(manifestBytes.toString('utf8')),
        input.rendererIdentity,
        clientBuild.buildId,
      );
      const assets = manifest.assets.map(asset => {
        const file = resolveFile(path.resolve(outputRoot, asset.file), {
          exact: true,
        });
        assert(
          file && within(outputRoot, file) && within(root, file),
          `Missing or external Octane emitted asset ${asset.file}`,
        );
        const sha256 = crypto
          .createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex');
        assert(
          sha256 === asset.sha256,
          `Octane emitted asset digest differs from actual bytes: ${asset.file}`,
        );
        nativeEmittedEntries.push(file);
        return { ...asset, path: path.relative(root, file) };
      });
      const sourceModules = manifest.sourceModules.map(source => {
        const resourcePath = source.resource.split('?')[0];
        const file = resolveFile(path.resolve(appRoot, resourcePath), {
          exact: true,
        });
        assert(
          file && within(root, file),
          `Missing or external Octane source resource ${source.resource}`,
        );
        const sha256 = crypto
          .createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex');
        assert(
          sha256 === source.sourceSha256,
          `Octane source digest differs from actual bytes: ${source.resource}`,
        );
        const binding = {
          ...source,
          path: path.relative(root, file),
          manifestPath: path.relative(root, manifestPath),
        };
        const variants = nativeSourceModules.get(file) ?? [];
        variants.push(binding);
        nativeSourceModules.set(file, variants);
        nativeEmittedEntries.push(file);
        return binding;
      });
      nativeCompilerProofs.push({
        validator: {
          installationName: validatorInstallation.name,
          name: validatorPackage.manifest.name,
          version: validatorPackage.manifest.version,
          path: path.relative(root, validatorPath),
          manifestSha256: validatorPackage.manifestSha256,
        },
        manifestPath: path.relative(root, manifestPath),
        manifestSha256: crypto
          .createHash('sha256')
          .update(manifestBytes)
          .digest('hex'),
        rendererIdentity: manifest.rendererIdentity,
        nativeHydrationBuildId: manifest.nativeHydrationBuildId,
        clientBuildMetadataPath: path.relative(root, clientBuildPath),
        clientBuildMetadataSha256: crypto
          .createHash('sha256')
          .update(clientBytes)
          .digest('hex'),
        runtimeVersion: manifest.runtimeVersion,
        compilerVersion: manifest.compilerVersion,
        sourceModules,
        assets,
      });
    }
  }
  const entryRoles = new Map();
  const scannedRoles = new Map();
  const pendingFiles = [];
  const enqueueFile = (file, role = 'runtime') => {
    const previous = entryRoles.get(file);
    if (previous === 'runtime' || previous === role) return;
    entryRoles.set(file, role);
    pendingFiles.push(file);
  };
  const directedEntries = new Set(
    entryFiles.map(file => {
      const resolved = resolveFile(path.resolve(root, file));
      assert(
        resolved && within(root, resolved),
        `Missing or external consumer entry ${file}`,
      );
      enqueueFile(resolved);
      return resolved;
    }),
  );
  for (const file of nativeEmittedEntries) {
    enqueueFile(file);
    directedEntries.add(file);
  }
  const ownedComputedServerLoaders = [];
  let activeServerBuild;
  let activeDevelopmentBuild;
  const ordinaryConsumerFile = (file, label) => {
    assert(within(root, file), `${label} escapes the clean consumer`);
    let current = root;
    for (const segment of path.relative(root, file).split(path.sep)) {
      current = path.join(current, segment);
      const stat = fs.lstatSync(current);
      assert(!stat.isSymbolicLink(), `${label} contains a symbolic link`);
    }
    assert(fs.lstatSync(file).isFile(), `${label} must be an ordinary file`);
    assert(
      fs.realpathSync(file) === file,
      `${label} must use its canonical physical path`,
    );
    return file;
  };
  const unverifiedBuildLoads = [];
  let hostBuildEvidence;
  if (buildEntryFiles.length > 0) {
    assert(
      buildCommandEvidence?.phase === 'build' &&
        buildCommandEvidence.exitCode === 0 &&
        typeof buildCommandEvidence.command === 'string' &&
        buildCommandEvidence.command.length > 0 &&
        typeof buildCommandEvidence.cwd === 'string' &&
        fs.realpathSync(buildCommandEvidence.cwd) === appRoot &&
        Array.isArray(buildCommandEvidence.args) &&
        buildCommandEvidence.args.every(
          argument => typeof argument === 'string',
        ),
      'Host build entries require the actual successful completed build command',
    );
    assert(
      typeof rendererBuildManifestPath === 'string' &&
        !path.isAbsolute(rendererBuildManifestPath),
      'Host build entries require the actual consumer-relative completed build manifest',
    );
    const manifestPath = ordinaryConsumerFile(
      path.resolve(root, rendererBuildManifestPath),
      'Host completed build manifest',
    );
    const bytes = fs.readFileSync(manifestPath);
    const value = JSON.parse(bytes);
    const hash = observedCompilerBuild({
      bytes,
      path: path.relative(root, manifestPath),
      evidence: rendererBuildEvidence,
      validated: value,
    });
    assert(
      value.schema === 'ultramodern-renderer-build' &&
        value.version === 1 &&
        value.profile?.renderer === renderer &&
        value.promotable === true &&
        /^[a-f0-9]{40}$/u.test(value.sourceRevision) &&
        (!producer || value.sourceRevision === producer.sourceRevision),
      'Host build selection must match the actual completed owning emission',
    );
    hostBuildEvidence = {
      command: structuredClone(buildCommandEvidence),
      manifest: {
        path: path.relative(root, manifestPath),
        sha256: hash,
        buildMarker: value.buildMarker,
        sourceRevision: value.sourceRevision,
      },
      roots: [],
      scope:
        'known resolved static host dependencies; unverified host loads are listed',
    };
    for (const evidence of buildEntryFiles) {
      assert(
        evidence &&
          ['configuration', 'metadata'].includes(evidence.purpose) &&
          typeof evidence.path === 'string' &&
          !path.isAbsolute(evidence.path) &&
          /^[a-f0-9]{64}$/u.test(evidence.sha256) &&
          Number.isSafeInteger(evidence.byteLength) &&
          evidence.byteLength >= 0,
        'Host build entries require observed purpose and pre-build file bytes',
      );
      const file = path.resolve(root, evidence.path);
      assert(
        within(appRoot, file) &&
          !path.relative(root, file).split(path.sep).includes('node_modules'),
        'Host build entry must be an application-owned configuration or metadata file',
      );
      ordinaryConsumerFile(file, 'Host build entry');
      const entryBytes = fs.readFileSync(file);
      assert(
        entryBytes.length === evidence.byteLength &&
          crypto.createHash('sha256').update(entryBytes).digest('hex') ===
            evidence.sha256,
        'Host build entry differs from the observed pre-build input',
      );
      hostBuildEvidence.roots.push({
        ...evidence,
        path: path.relative(root, file),
      });
      enqueueFile(file, 'host-build');
    }
  }
  const deferBuildLoad = (file, imported, kind) => {
    unverifiedBuildLoads.push({
      source: path.relative(root, file),
      sourceSha256: scanned.get(file),
      line: imported.line ?? null,
      specifier: imported.specifier ?? null,
      kind:
        kind ??
        (imported.requirePath
          ? 'unverifiable-require-anchor'
          : imported.require
            ? 'computed-require'
            : 'computed-import'),
      admission: 'unverified-host-build-load',
    });
  };
  const hostMetadataValidators = [];
  const installedProducer = sourceName => {
    const artifact = producer?.artifacts.find(
      item => item.sourceName === sourceName,
    );
    assert(
      artifact,
      `Native server loader requires authenticated producer mapping for ${sourceName}`,
    );
    const installation = [artifact.targetName, sourceName]
      .map(name => ({ name, record: installedPackage(name, appRoot, root) }))
      .find(item => item.record?.manifest.name === artifact.targetName);
    assert(
      installation,
      `Native server loader has no installed owning package ${sourceName}`,
    );
    authenticateProducerPackage(installation.record);
    add(installation.record);
    const require = createRequire(path.join(appRoot, 'package.json'));
    const entry = fs.realpathSync(require.resolve(installation.name));
    assert(
      within(installation.record.directory, entry),
      'Native server loader public validator escapes its owning package',
    );
    hostMetadataValidators.push({
      sourceName,
      targetName: installation.record.manifest.name,
      path: path.relative(root, entry),
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(entry))
        .digest('hex'),
      artifactSha256: artifact.sha256,
      purpose: 'executed-owning-metadata-validator',
    });
    return { ...installation, entry, exports: require(entry) };
  };
  const activationFrames = {
    source: ['src/native-composition/', '.ts'],
    import: ['dist/esm-node/native-composition/', '.mjs'],
    require: ['dist/cjs/native-composition/', '.js'],
  };
  const activationDispatcherFormat = relative =>
    Object.entries(activationFrames).find(
      ([, [prefix, suffix]]) =>
        relative === `${prefix}renderer-compiler-activation${suffix}`,
    )?.[0];
  let compilerActivation;
  const ownedCompilerActivations = [];
  const verifiedCompilerDispatcherOrigins = new Set();
  const ownedSelfExportLoaders = [];
  const verifiedComposedRegistrationOrigins = new Set();
  const bindCompilerActivation = () => {
    if (compilerActivation) return compilerActivation;
    assert(
      typeof rendererBuildManifestPath === 'string' &&
        !path.isAbsolute(rendererBuildManifestPath),
      'Compiler activation requires the actual consumer-relative renderer build manifest',
    );
    for (const record of records.values())
      if (producerPackages.has(record.manifest.name))
        authenticateProducerPackage(record);
    const validator = installedProducer('@modern-js/ultramodern-app-tools');
    const artifact = producer.artifacts.find(
      item => item.targetName === validator.record.manifest.name,
    );
    const files = new Map();
    const read = relative => {
      assert(
        typeof relative === 'string' &&
          path.posix.normalize(relative) === relative &&
          !relative.startsWith('../') &&
          !path.posix.isAbsolute(relative) &&
          !relative.includes('\\'),
        'Compiler activation file must be a canonical package-relative path',
      );
      const target = ordinaryConsumerFile(
        path.join(validator.record.directory, relative),
        'Compiler activation file',
      );
      const bytes = fs.readFileSync(target);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      const archived = artifact.files.find(item => item.path === relative);
      assert(
        archived?.sha256 === hash && archived.size === bytes.length,
        'Compiler activation file differs from authenticated release bytes',
      );
      files.set(target, { path: path.relative(root, target), sha256: hash });
      return bytes.toString('utf8');
    };
    const { syntax, primitiveUnchanged } = compilerActivationAstAuthority();
    const catalogue = readCompilerActivationCatalogue({
      read,
      primitiveUnchanged,
    });
    const selected = catalogue.find(item => item.renderer === renderer);
    assert(selected, 'Compiler activation has no selected finite registration');
    const manifestFile = ordinaryConsumerFile(
      path.resolve(root, rendererBuildManifestPath),
      'Compiler activation build manifest',
    );
    assert(
      path.basename(manifestFile) ===
        validator.exports.RENDERER_BUILD_MANIFEST_FILE &&
        typeof validator.exports.resolveRendererProfile === 'function' &&
        typeof validator.exports.validateRendererBuildManifest === 'function',
      'Compiler activation requires the actual public profile and build validator',
    );
    const manifestBytes = fs.readFileSync(manifestFile);
    const manifestSha256 = crypto
      .createHash('sha256')
      .update(manifestBytes)
      .digest('hex');
    const profile = validator.exports.resolveRendererProfile(renderer);
    const manifest = validator.exports.validateRendererBuildManifest(
      JSON.parse(manifestBytes),
      profile,
    );
    observedCompilerBuild({
      bytes: manifestBytes,
      path: path.relative(root, manifestFile),
      evidence: rendererBuildEvidence,
      validated: manifest,
    });
    assert(
      manifest.profile.renderer === renderer &&
        manifest.sourceRevision === producer.sourceRevision,
      'Compiler activation build selection conflicts with its source release',
    );
    const compositions = new Map();
    const dispatchers = new Map();
    const registries = new Set();
    for (const [format, [prefix, suffix]] of Object.entries(activationFrames)) {
      const composition = `${prefix}index${suffix}`;
      const dispatcher = `${prefix}renderer-compiler-activation${suffix}`;
      const registry = `${prefix}renderer-registration${suffix}`;
      const source = read(composition);
      assert(
        compilerDispatcherCaller(source, composition, syntax),
        'Compiler activation dispatcher has no verified selected native caller',
      );
      compositions.set(
        path.join(validator.record.directory, composition),
        source,
      );
      dispatchers.set(
        path.join(validator.record.directory, dispatcher),
        format,
      );
      read(dispatcher);
      read(registry);
      registries.add(path.join(validator.record.directory, registry));
    }
    for (const record of catalogue)
      for (const [format, [prefix, suffix]] of Object.entries(
        activationFrames,
      )) {
        if (format === 'source') continue;
        read(
          `${prefix.replace(/native-composition\/$/u, '')}${record.registration.slice(4, -3)}${suffix}`,
        );
      }
    compilerActivation = {
      validator,
      artifact,
      files,
      read,
      catalogue,
      selected,
      compositions,
      dispatchers,
      registries,
      manifest: {
        path: path.relative(root, manifestFile),
        sha256: manifestSha256,
        sourceRevision: manifest.sourceRevision,
        buildMarker: manifest.buildMarker,
        inputDigest: manifest.inputDigest,
        profileDigest: manifest.profileDigest,
        compilerDigest: manifest.compilerDigest,
        frameworkCohortDigest: manifest.frameworkCohortDigest,
        profile,
      },
    };
    return compilerActivation;
  };
  const composedRegistrationForFile = (authority, file) =>
    authority.catalogue.find(
      record =>
        record.kind === 'composed' &&
        Object.entries(activationFrames).some(
          ([format, [prefix, suffix]]) =>
            file ===
            path.join(
              authority.validator.record.directory,
              format === 'source'
                ? record.registration
                : `${prefix.replace(/native-composition\/$/u, '')}${record.registration.slice(4, -3)}${suffix}`,
            ),
        ),
    );
  const bindActiveServerBuild = () => {
    if (activeServerBuild) return activeServerBuild;
    assert(
      typeof rendererBuildManifestPath === 'string' &&
        !path.isAbsolute(rendererBuildManifestPath),
      'Active native server loader requires the actual consumer-relative renderer build manifest',
    );
    // The installed public entry may load its declared framework dependencies.
    // Authenticate that complete already-selected graph before executing it.
    for (const record of records.values()) {
      if (record.manifest.name.startsWith('@modern-js/'))
        assert(
          false,
          'Native server validator cannot load an unmapped framework package',
        );
      if (producerPackages.has(record.manifest.name))
        authenticateProducerPackage(record);
      else if (record.manifest.name.startsWith('@bleedingdev/modern-js-'))
        assert(
          false,
          'Native server validator dependency is outside the producer artifact cohort',
        );
    }
    const validator = installedProducer('@modern-js/ultramodern-app-tools');
    assert(
      typeof validator.exports.resolveRendererProfile === 'function' &&
        typeof validator.exports.validateRendererBuildManifest === 'function' &&
        validator.exports.RENDERER_BUILD_MANIFEST_FILE ===
          'renderer-build.json',
      'Native server loader requires the actual public build profile and manifest validator',
    );
    const manifestPath = ordinaryConsumerFile(
      path.resolve(root, rendererBuildManifestPath),
      'Native renderer build manifest',
    );
    assert(
      path.basename(manifestPath) ===
        validator.exports.RENDERER_BUILD_MANIFEST_FILE,
      'Native server loader requires the canonical renderer build manifest filename',
    );
    const bytes = fs.readFileSync(manifestPath);
    const profile = validator.exports.resolveRendererProfile(renderer);
    assert(
      profile?.renderer === renderer,
      'Native server loader selected profile conflicts with its renderer',
    );
    const manifest = validator.exports.validateRendererBuildManifest(
      JSON.parse(bytes),
      profile,
    );
    assert(
      manifest?.profile?.renderer === renderer,
      'Native server loader manifest conflicts with its selected renderer',
    );
    const utils = installedProducer('@modern-js/utils');
    const bundleDirectory = utils.exports.SERVER_BUNDLE_DIRECTORY;
    assert(
      typeof bundleDirectory === 'string' &&
        bundleDirectory.length > 0 &&
        bundleDirectory === path.posix.normalize(bundleDirectory) &&
        !path.posix.isAbsolute(bundleDirectory) &&
        !bundleDirectory.split('/').some(segment => segment === '..') &&
        !bundleDirectory.includes('\\'),
      'Native server loader owning server bundle directory is invalid',
    );
    const distDirectory = path.dirname(manifestPath);
    const modules = Object.entries(manifest.identities).map(
      ([entryName, identity]) => {
        assert(
          entryName &&
            entryName !== '.' &&
            entryName !== '..' &&
            !entryName.includes('/') &&
            !entryName.includes('\\') &&
            identity?.entryName === entryName &&
            identity.renderer === renderer &&
            identity.buildId === manifest.buildMarker,
          'Native server loader requires canonical manifest entry identities',
        );
        const file = ordinaryConsumerFile(
          path.join(distDirectory, bundleDirectory, `${entryName}.js`),
          `Native compiled server entry ${entryName}`,
        );
        assert(
          within(distDirectory, file),
          'Native compiled server entry escapes its finalized output',
        );
        const moduleBytes = fs.readFileSync(file);
        assertNativeServerModuleExports(
          moduleBytes.toString('utf8'),
          file,
          identity,
        );
        enqueueFile(file);
        return {
          entryName,
          rendererIdentity: identity,
          path: path.relative(root, file),
          sha256: crypto.createHash('sha256').update(moduleBytes).digest('hex'),
        };
      },
    );
    assert(
      modules.length > 0,
      'Native server loader manifest has no compiled server entries',
    );
    activeServerBuild = {
      manifestPath: path.relative(root, manifestPath),
      manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      buildMarker: manifest.buildMarker,
      sourceRevision: manifest.sourceRevision,
      frameworkCohortDigest: manifest.frameworkCohortDigest,
      profile,
      publicValidator: {
        name: validator.record.manifest.name,
        version: validator.record.manifest.version,
        path: path.relative(root, validator.entry),
      },
      serverBundleDirectory: bundleDirectory,
      modules,
    };
    return activeServerBuild;
  };
  const bindActiveDevelopmentBuild = () => {
    if (activeDevelopmentBuild) return activeDevelopmentBuild;
    const production = bindActiveServerBuild();
    assert(
      typeof rendererDevelopmentManifestPath === 'string' &&
        !path.isAbsolute(rendererDevelopmentManifestPath),
      'Active native development loader requires the actual consumer-relative development renderer manifest',
    );
    const validator = installedProducer('@modern-js/ultramodern-app-tools');
    assert(
      typeof validator.exports.validateRendererDevelopmentBuildManifest ===
        'function' &&
        validator.exports.RENDERER_DEVELOPMENT_DIRECTORY === '.ultramodern-dev',
      'Native development loader requires the actual public development manifest validator and directory',
    );
    const canonicalPath = path.join(
      path.dirname(path.resolve(root, production.manifestPath)),
      validator.exports.RENDERER_DEVELOPMENT_DIRECTORY,
      validator.exports.RENDERER_BUILD_MANIFEST_FILE,
    );
    assert(
      path.resolve(root, rendererDevelopmentManifestPath) === canonicalPath,
      'Native development loader requires the canonical development renderer manifest path',
    );
    const file = ordinaryConsumerFile(
      canonicalPath,
      'Native development renderer manifest',
    );
    const bytes = fs.readFileSync(file);
    const metadata = validator.exports.validateRendererDevelopmentBuildManifest(
      JSON.parse(bytes),
      production.profile,
    );
    assert(
      metadata?.profile?.renderer === renderer &&
        metadata.cacheAllowed === false &&
        metadata.promotable === false &&
        JSON.stringify(Object.keys(metadata.identities).sort()) ===
          JSON.stringify(
            production.modules.map(module => module.entryName).sort(),
          ),
      'Native development manifest requires its selected profile and actual application entry set',
    );
    activeDevelopmentBuild = {
      manifestPath: path.relative(root, file),
      manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      buildMarker: metadata.buildMarker,
      sourceRevision: metadata.sourceRevision,
      frameworkCohortDigest: metadata.frameworkCohortDigest,
      devCompilation: metadata.devCompilation,
      identities: metadata.identities,
      publicValidator: {
        name: validator.record.manifest.name,
        version: validator.record.manifest.version,
        path: path.relative(root, validator.entry),
      },
      checkpointRuntimeAuthority:
        'owning-native-development-provider-and-browser-gates',
    };
    return activeDevelopmentBuild;
  };
  const authenticateTypeEdge = (from, to, imported) => {
    const fromFact = authenticatedDeclarationFiles.get(from);
    const toFact = authenticatedDeclarationFiles.get(to);
    const expectedIncoming =
      fromFact &&
      typeEvidence().incomingEdges.find(
        item =>
          item.from === fromFact.packagePath &&
          item.specifier === imported.specifier &&
          item.line === imported.line,
      );
    if (expectedIncoming)
      assert(
        toFact?.packagePath === expectedIncoming.to,
        `Octane native declaration edge does not resolve its authenticated target ${expectedIncoming.to}`,
      );
    if (!toFact) return;
    const edge = typeEvidence().incomingEdges.find(
      item =>
        item.from === fromFact?.packagePath &&
        item.to === toFact.packagePath &&
        item.specifier === imported.specifier &&
        item.line === imported.line,
    );
    const kind = imported.namespaceTypeImport
      ? 'import type namespace'
      : imported.reference === 'path'
        ? 'triple-slash reference path'
        : imported.exportTypeAll
          ? 'export type *'
          : undefined;
    if (toFact.owner === '@types/react') {
      assert(
        edge &&
          edge.kind === kind &&
          imported.typeOnly &&
          !imported.augmentation &&
          !imported.jsxSource,
        `Forbidden incoming Octane React declaration edge from ${path.relative(root, from)} to ${toFact.packagePath}`,
      );
      permittedReactDeclarationFiles.add(to);
    }
    if (edge && edge.kind === kind)
      authenticatedTypeEdges.push({
        ...edge,
        fromPath: path.relative(root, from),
        toPath: path.relative(root, to),
        fromSha256: fromFact.sha256,
        toSha256: toFact.sha256,
      });
  };
  const scanned = new Map();
  const moduleFormatScopes = new Map();
  const declarationFallbacks = [];
  const ownedRequireAnchors = [];
  const promoteSelectedFileOwner = file => {
    const containing = [...records.values()]
      .filter(record => within(record.directory, file))
      .sort((left, right) => right.directory.length - left.directory.length)[0];
    const parts = file.split(path.sep);
    const installedIndex = parts.lastIndexOf('node_modules');
    const installedName = parts[installedIndex + 1];
    const installedBoundary =
      installedIndex >= 0 && installedName !== '.modern-js';
    let directory = installedBoundary
      ? parts
          .slice(0, installedIndex + (installedName?.startsWith('@') ? 3 : 2))
          .join(path.sep)
      : path.dirname(file);
    // A nested installation owns its selected files even when its enclosing
    // package was already recorded. Ordinary package.json files inside one
    // installation do not establish another installed owner.
    if (
      containing &&
      installedBoundary &&
      containing.directory.length >= directory.length
    ) {
      add(containing);
      return containing;
    }
    while (within(root, directory)) {
      const known = records.get(directory);
      if (known) {
        add(known);
        return known;
      }
      if (contexts.some(context => context.directory === directory)) return;
      const manifestPath = path.join(directory, 'package.json');
      if (installedBoundary)
        assert(
          fs.existsSync(manifestPath),
          'Selected installed file has no actual owning package manifest',
        );
      if (fs.existsSync(manifestPath)) {
        assert(
          fs.lstatSync(manifestPath).isFile() &&
            within(root, fs.realpathSync(manifestPath)),
          'Selected file owner requires an ordinary consumer package manifest',
        );
        const bytes = fs.readFileSync(manifestPath);
        const manifest = JSON.parse(bytes);
        if (
          !installedBoundary &&
          Object.keys(manifest).length === 1 &&
          ['module', 'commonjs'].includes(manifest.type)
        ) {
          const scope = {
            path: path.relative(root, manifestPath),
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            type: manifest.type,
          };
          assert(
            !moduleFormatScopes.has(manifestPath) ||
              moduleFormatScopes.get(manifestPath).sha256 === scope.sha256,
            'Module format scope changed during its selected file audit',
          );
          moduleFormatScopes.set(manifestPath, scope);
          directory = path.dirname(directory);
          continue;
        }
        assert(
          typeof manifest.name === 'string' &&
            exactVersion.test(manifest.version),
          'Selected file has an invalid owning package identity',
        );
        return add({
          directory,
          manifest,
          manifestSha256: crypto
            .createHash('sha256')
            .update(bytes)
            .digest('hex'),
        });
      }
      const parent = path.dirname(directory);
      if (parent === directory) return;
      directory = parent;
    }
  };
  while (pendingFiles.length) {
    const file = pendingFiles.pop();
    const role = entryRoles.get(file);
    if (scannedRoles.get(file) === 'runtime' || scannedRoles.get(file) === role)
      continue;
    assert(
      within(root, file),
      `Entry import resolves outside the clean consumer: ${file}`,
    );
    const selectedOwner = promoteSelectedFileOwner(file);
    if (
      renderer === 'octane' &&
      selectedOwner?.manifest.name === '@types/react'
    ) {
      assert(
        !directedEntries.has(file) && permittedReactDeclarationFiles.has(file),
        `Forbidden direct or unowned Octane React declaration entry ${path.relative(root, file)}`,
      );
      const relative = path
        .relative(selectedOwner.directory, file)
        .split(path.sep)
        .join('/');
      assert(
        typeEvidence().declaredScope.exactPermittedFiles.includes(
          `@types/react/${relative}`,
        ),
        `Forbidden additional Octane React declaration file ${relative}`,
      );
      authenticateDeclaration(selectedOwner, `@types/react/${relative}`);
    }
    if (nativeTypeOwner(selectedOwner)) {
      const relative = path
        .relative(selectedOwner.directory, file)
        .split(path.sep)
        .join('/');
      if (
        typeEvidence().nativeFiles.some(
          item => item.packagePath === `octane/${relative}`,
        )
      )
        authenticateDeclaration(selectedOwner, `octane/${relative}`);
    }
    const bytes = fs.readFileSync(file);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    assert(
      !scanned.has(file) || scanned.get(file) === hash,
      'Selected source bytes changed during host-to-runtime promotion',
    );
    scanned.set(file, hash);
    scannedRoles.set(file, role);
    if (!/\.(?:[cm]?[jt]sx?|tsrx)$/u.test(file)) continue;
    const source = bytes.toString('utf8');
    if (native)
      assert(
        !bundledReact.test(source),
        `${renderer} entry contains bundled React/RSC runtime: ${path.relative(root, file)}`,
      );
    // Native syntax is certified by the owning compiler's exact source/asset
    // evidence; its emitted JavaScript is independently scanned above.
    if (file.endsWith('.tsrx') && nativeSourceModules.has(file)) continue;
    const imports = moduleSpecifiers(source, file);
    const dispatcherFormat =
      selectedOwner &&
      activationDispatcherFormat(
        path.relative(selectedOwner.directory, file).split(path.sep).join('/'),
      );
    if (
      dispatcherFormat &&
      imports.some(imported => imported.computed && imported.importPath)
    )
      assert(
        !directedEntries.has(file) &&
          verifiedCompilerDispatcherOrigins.has(file),
        'Private compiler dispatcher has no verified incoming selected composition',
      );
    for (const imported of imports) {
      let importDirectory = path.dirname(file);
      let requireAnchor;
      if (imported.computed && dispatcherFormat) {
        assert(
          !directedEntries.has(file) &&
            verifiedCompilerDispatcherOrigins.has(file),
          'Private compiler dispatcher has no verified incoming selected composition',
        );
        const authority = bindCompilerActivation();
        const { syntax, primitiveUnchanged } = compilerActivationAstAuthority();
        assert(
          authority.dispatchers.get(file) === dispatcherFormat &&
            compilerDispatcherImport(
              imported.importPath,
              syntax,
              primitiveUnchanged,
            ),
          'Unverifiable selected compiler activation dispatcher',
        );
        const format =
          dispatcherFormat === 'source' ? 'import' : dispatcherFormat;
        const target =
          authority.selected.kind === 'native'
            ? path.join(
                authority.validator.record.directory,
                authority.selected.module[format],
              )
            : undefined;
        if (target) enqueueFile(target, role);
        ownedCompilerActivations.push({
          source: path.relative(root, file),
          sourceSha256: scanned.get(file),
          artifactSha256: authority.artifact.sha256,
          selectedRenderer: renderer,
          selectedKind: authority.selected.kind,
          role,
          format,
          build: authority.manifest,
          catalogue: authority.catalogue,
          declarations: [...authority.files.values()],
          target: target ? path.relative(root, target) : null,
          targetSha256: target ? authority.files.get(target).sha256 : null,
        });
        continue;
      }
      if (imported.requirePath) {
        const self = owningSelfExportRequire(
          imported.requirePath,
          nodeModuleAst({ strict: true }),
          globalPrimitiveUnchanged,
        );
        if (self) {
          const artifact = producer?.artifacts.find(
            item => item.targetName === selectedOwner?.manifest.name,
          );
          assert(
            artifact && selectedOwner,
            'Owning self export requires authenticated release ownership',
          );
          authenticateProducerPackage(selectedOwner);
          const sourceRelative = path
            .relative(selectedOwner.directory, file)
            .split(path.sep)
            .join('/');
          assert(
            artifact.files.find(item => item.path === sourceRelative)
              ?.sha256 === scanned.get(file),
            'Owning self-export loader differs from authenticated module bytes',
          );
          if (self.moduleUrl === 'rslib-file-url')
            assert(
              fileURLToPath(new URL(`file:${file}`)) === file,
              'Emitted self-export module URL differs from its physical filename',
            );
          let directory = path.dirname(file);
          let manifestFile;
          while (within(selectedOwner.directory, directory)) {
            const candidate = path.join(directory, 'package.json');
            if (fs.existsSync(candidate)) {
              manifestFile = ordinaryConsumerFile(
                candidate,
                'Self-export package scope',
              );
              break;
            }
            if (directory === selectedOwner.directory) break;
            directory = path.dirname(directory);
          }
          assert(
            manifestFile ===
              path.join(selectedOwner.directory, 'package.json') &&
              crypto
                .createHash('sha256')
                .update(fs.readFileSync(manifestFile))
                .digest('hex') === selectedOwner.manifestSha256,
            'Self-export locator selected a foreign or changed package scope',
          );
          const specifier = `${selectedOwner.manifest.name}${self.subpath.slice(1)}`;
          assert(
            Object.hasOwn(selectedOwner.manifest.exports ?? {}, self.subpath),
            'Owning package does not declare the exact self export',
          );
          const entry = exportedEntry(
            selectedOwner.manifest,
            specifier,
            new Set(['node', 'require', 'default']),
          );
          assert(
            typeof entry === 'string' &&
              entry.startsWith('./') &&
              path.posix.normalize(entry) === entry.slice(2) &&
              !entry.includes('\\') &&
              !entry
                .slice(2)
                .split('/')
                .some(segment => segment === '..'),
            'Owning self export has no canonical Node require target',
          );
          const target = ordinaryConsumerFile(
            path.join(selectedOwner.directory, entry),
            'Owning self-export target',
          );
          assert(
            within(selectedOwner.directory, target) &&
              fs.realpathSync(createRequire(file).resolve(specifier)) ===
                target,
            'Self export resolves outside its exact owning declaration',
          );
          const targetBytes = fs.readFileSync(target);
          const targetSha256 = crypto
            .createHash('sha256')
            .update(targetBytes)
            .digest('hex');
          const archivedTarget = artifact.files.find(
            item => item.path === entry.slice(2),
          );
          assert(
            archivedTarget?.sha256 === targetSha256 &&
              archivedTarget.size === targetBytes.length,
            'Owning self-export target differs from authenticated release bytes',
          );
          let active = true;
          let build;
          if (artifact.sourceName === '@modern-js/ultramodern-app-tools') {
            const authority = bindCompilerActivation();
            const registration = composedRegistrationForFile(authority, file);
            assert(
              registration && registration.compose === self.functionName,
              'Self export is outside its authenticated composed registration',
            );
            active =
              authority.selected.renderer === registration.renderer &&
              authority.selected.kind === 'composed';
            assert(
              active ||
                (!directedEntries.has(file) &&
                  verifiedComposedRegistrationOrigins.has(file)),
              'Inactive composed self export has no verified registry origin',
            );
            build = authority.manifest;
          }
          if (active) enqueueFile(target, role);
          ownedSelfExportLoaders.push({
            ...self,
            source: path.relative(root, file),
            sourceSha256: scanned.get(file),
            ownerManifest: path.relative(root, manifestFile),
            ownerManifestSha256: selectedOwner.manifestSha256,
            artifactSha256: artifact.sha256,
            selectedRenderer: renderer,
            active,
            role,
            ...(build ? { build } : {}),
            target: path.relative(root, target),
            targetSha256,
          });
          continue;
        }
        const anchor = createRequireAnchor(imported.requirePath);
        if (!anchor && role === 'host-build') {
          deferBuildLoad(file, imported);
          continue;
        }
        assert(
          anchor,
          `Unverifiable createRequire anchor in ${path.relative(root, file)}`,
        );
        let directory = path.dirname(file);
        let sentinel;
        let artifact;
        if (anchor.kind === 'package') {
          artifact = producer?.artifacts.find(
            item => item.targetName === selectedOwner?.manifest.name,
          );
          assert(
            artifact && selectedOwner,
            'Package createRequire locator requires authenticated release ownership',
          );
          authenticateProducerPackage(selectedOwner);
          const modulePath = path
            .relative(selectedOwner.directory, file)
            .split(path.sep)
            .join('/');
          const candidate = artifact.files.find(
            item => item.path === modulePath,
          );
          assert(
            candidate?.sha256 === scanned.get(file) &&
              candidate.size === bytes.length,
            'Package createRequire locator differs from authenticated module bytes',
          );
          let found = false;
          while (within(selectedOwner.directory, directory)) {
            const manifest = path.join(directory, 'package.json');
            const privateDirectory = path.join(
              directory,
              anchor.relativeDirectory,
            );
            const marker = path.join(privateDirectory, anchor.sentinel);
            if (fs.existsSync(manifest) && fs.existsSync(marker)) {
              assert(
                directory === selectedOwner.directory,
                'Package createRequire locator selected a foreign package root',
              );
              ordinaryConsumerFile(
                manifest,
                'Package createRequire owner manifest',
              );
              ordinaryConsumerFile(marker, 'Package createRequire sentinel');
              const sentinelPath = path
                .relative(selectedOwner.directory, marker)
                .split(path.sep)
                .join('/');
              const sentinelHash = crypto
                .createHash('sha256')
                .update(fs.readFileSync(marker))
                .digest('hex');
              assert(
                artifact.files.find(item => item.path === sentinelPath)
                  ?.sha256 === sentinelHash,
                'Package createRequire sentinel differs from authenticated bytes',
              );
              sentinel = {
                path: path.relative(root, marker),
                sha256: sentinelHash,
              };
              directory = privateDirectory;
              found = true;
              break;
            }
            if (directory === selectedOwner.directory) break;
            directory = path.dirname(directory);
          }
          assert(
            found,
            'Package createRequire locator has no authenticated owning root',
          );
        }
        const logicalAnchor = anchor.logicalFilename
          ? path.join(directory, anchor.logicalFilename)
          : file;
        importDirectory = path.dirname(logicalAnchor);
        assert(
          within(root, importDirectory),
          'createRequire anchor escapes the clean consumer',
        );
        let current = root;
        for (const segment of path
          .relative(root, importDirectory)
          .split(path.sep)) {
          if (!segment) continue;
          current = path.join(current, segment);
          assert(
            fs.lstatSync(current).isDirectory(),
            'createRequire anchor requires ordinary physical directories',
          );
        }
        assert(
          fs.realpathSync(importDirectory) === importDirectory,
          'createRequire anchor must use its canonical physical directory',
        );
        const packageScopes = [];
        for (
          let scope = importDirectory;
          within(root, scope);
          scope = path.dirname(scope)
        ) {
          const manifest = path.join(scope, 'package.json');
          if (fs.existsSync(manifest)) {
            ordinaryConsumerFile(manifest, 'createRequire package scope');
            const scopeBytes = fs.readFileSync(manifest);
            const scopeHash = crypto
              .createHash('sha256')
              .update(scopeBytes)
              .digest('hex');
            const known =
              records.get(scope) ??
              contexts.find(context => context.directory === scope);
            assert(
              !known || known.manifestSha256 === scopeHash,
              'createRequire package scope changed from its initial manifest bytes',
            );
            packageScopes.push({
              path: path.relative(root, manifest),
              sha256: scopeHash,
              type: JSON.parse(scopeBytes).type ?? null,
            });
          }
          if (scope === (selectedOwner?.directory ?? root)) break;
        }
        requireAnchor = {
          source: path.relative(root, file),
          sourceSha256: scanned.get(file),
          line: imported.line,
          role,
          kind: anchor.kind,
          logicalAnchor: path.relative(root, logicalAnchor),
          packageScopes,
          ...(artifact
            ? {
                sourceName: artifact.sourceName,
                targetName: artifact.targetName,
                artifactSha256: artifact.sha256,
                locatorLine: anchor.locatorLine,
                ownerManifestSha256: selectedOwner.manifestSha256,
                sentinel,
              }
            : {}),
        };
      }
      if (imported.computed) {
        const artifact = producer?.artifacts.find(
          item => item.sourceName === '@modern-js/ultramodern-app-tools',
        );
        const relative =
          selectedOwner &&
          path
            .relative(selectedOwner.directory, file)
            .split(path.sep)
            .join('/');
        const knownProductionModule = [
          'dist/cjs/native-composition/native-infrastructure.js',
          'dist/esm-node/native-composition/native-infrastructure.mjs',
        ].includes(relative);
        const knownDevelopmentModule = [
          'dist/cjs/native-composition/native-development.js',
          'dist/esm-node/native-composition/native-development.mjs',
        ].includes(relative);
        if (
          role === 'host-build' &&
          !(
            artifact &&
            selectedOwner?.manifest.name === artifact.targetName &&
            ((knownProductionModule &&
              nativeServerLoaderImport(
                imported.importPath,
                producer.aliases,
              )) ||
              (knownDevelopmentModule &&
                nativeDevelopmentLoaderImport(
                  imported.importPath,
                  producer.aliases,
                )))
          )
        ) {
          deferBuildLoad(file, imported);
          continue;
        }
        assert(
          artifact &&
            selectedOwner?.manifest.name === artifact.targetName &&
            ((knownProductionModule &&
              nativeServerLoaderImport(
                imported.importPath,
                producer.aliases,
              )) ||
              (knownDevelopmentModule &&
                nativeDevelopmentLoaderImport(
                  imported.importPath,
                  producer.aliases,
                ))),
          `Unverifiable computed module import in ${path.relative(root, file)}`,
        );
        authenticateProducerPackage(selectedOwner);
        const candidateFile = artifact.files.find(
          item => item.path === relative,
        );
        assert(
          candidateFile?.sha256 === scanned.get(file) &&
            candidateFile.size === bytes.length,
          'Native server loader is not bound to the actual candidate module bytes',
        );
        ownedComputedServerLoaders.push({
          path: path.relative(root, file),
          line: imported.line,
          sourceName: artifact.sourceName,
          targetName: artifact.targetName,
          sha256: scanned.get(file),
          artifactSha256: artifact.sha256,
          admission: native
            ? knownDevelopmentModule
              ? 'active-native-guarded-development-declaration'
              : 'active-native-finalized-server-build'
            : 'dormant-react-host-declaration',
          selectedRenderer: renderer,
          build: native ? bindActiveServerBuild() : null,
          ...(knownDevelopmentModule
            ? {
                development: native ? bindActiveDevelopmentBuild() : null,
                checkpointRuntimeAuthority:
                  'owning-native-development-provider-and-browser-gates',
              }
            : {}),
        });
        continue;
      }
      const specifier = imported.specifier;
      let unresolvedHostRequire =
        role === 'host-build' &&
        imported.require &&
        !imported.typeOnly &&
        !imported.reference &&
        !/\.d\.[cm]?ts$/u.test(file);
      const name = packageName(specifier);
      const octaneTypeOwner =
        renderer === 'octane' &&
        specifier === 'react' &&
        imported.typeOnly &&
        imported.namespaceTypeImport &&
        !imported.augmentation &&
        !imported.jsxSource &&
        [...records.values()].some(
          record =>
            nativeTypeOwner(record) &&
            ['dist/public-types.d.ts', 'dist/jsx-runtime.d.ts'].includes(
              path.relative(record.directory, file).split(path.sep).join('/'),
            ),
        );
      if (native)
        assert(
          (octaneTypeOwner || !forbiddenNativePackage(name, renderer)) &&
            !specifier.startsWith('react-server-dom-') &&
            specifier !== 'octane/react' &&
            !specifier.startsWith('octane/react/'),
          `${renderer} entry imports forbidden React/RSC module ${specifier} in ${path.relative(root, file)}`,
        );
      if (imported.augmentation) continue;
      if (
        !imported.reference &&
        (specifier.startsWith('node:') || builtins.has(specifier))
      )
        continue;
      let target;
      if (specifier.startsWith('.') || imported.reference === 'path')
        target =
          imported.typeOnly || /\.d\.[cm]?ts$/u.test(file)
            ? resolveTypeFile(path.resolve(importDirectory, specifier))
            : resolveFile(
                path.resolve(importDirectory, specifier),
                requireAnchor
                  ? {
                      beforeRealpath: selected => {
                        if (requireAnchor.kind === 'package')
                          assert(
                            within(selectedOwner.directory, selected),
                            'Package createRequire target escapes its owning package',
                          );
                        ordinaryConsumerFile(
                          selected,
                          'Package createRequire target',
                        );
                      },
                    }
                  : undefined,
              );
      else {
        let installedName = octaneTypeOwner ? '@types/react' : name;
        let record = installedPackage(installedName, importDirectory, root);
        let declarationFallbackOwner;
        if (
          !record &&
          (imported.reference === 'types' ||
            imported.typeOnly ||
            /\.d\.[cm]?ts$/u.test(file)) &&
          !name.startsWith('@types/')
        ) {
          installedName = `@types/${name.replace(/^@/u, '').replace('/', '__')}`;
          if (imported.reference === 'types')
            record = installedPackage(installedName, importDirectory, root);
          else {
            declarationFallbackOwner =
              selectedOwner ??
              contexts
                .filter(context => within(context.directory, file))
                .sort(
                  (left, right) =>
                    right.directory.length - left.directory.length,
                )[0];
            const declared =
              declarationFallbackOwner?.manifest.dependencies?.[installedName];
            assert(
              typeof declared === 'string',
              `Declaration fallback ${installedName} requires its owner's declared production dependency`,
            );
            record = resolveEdge(
              {
                name: installedName,
                specifier: declared,
                block: 'dependencies',
                optional: false,
              },
              declarationFallbackOwner,
            );
            const sourceProvider = installedPackage(
              installedName,
              importDirectory,
              root,
            );
            assert(
              sourceProvider?.directory === record?.directory &&
                sourceProvider?.manifestSha256 === record?.manifestSha256,
              `Declaration fallback ${installedName} resolves a different provider from its source`,
            );
            assert(
              record?.manifest.name === installedName,
              `Declaration fallback ${installedName} has an invalid physical package identity`,
            );
            assert(
              record.manifestSha256 ===
                records.get(record.directory)?.manifestSha256,
              'Declaration fallback evidence changed during its static closure audit',
            );
            ordinaryConsumerFile(
              path.join(record.directory, 'package.json'),
              'Declaration fallback package manifest',
            );
          }
        }
        if (!record && unresolvedHostRequire) {
          deferBuildLoad(file, imported, 'unresolved-require');
          continue;
        }
        assert(
          record,
          `Unresolved installed entry import ${specifier} in ${path.relative(root, file)}`,
        );
        // A physical provider was found: its exports and target stay strict.
        unresolvedHostRequire = false;
        if (octaneTypeOwner)
          assert(
            record.manifest.name === '@types/react' &&
              record.manifest.version ===
                typeEvidence().declaredScope.reactTypesVersion,
            'Octane React import must resolve the exact authenticated @types/react identity',
          );
        const frameworkIdentity = canonicalFrameworkIdentity(installedName);
        if (frameworkIdentity)
          assert(
            record.manifest.name === frameworkIdentity,
            `Selected framework import ${specifier} must resolve its canonical mapped identity ${frameworkIdentity}`,
          );
        add(record);
        const conditions = new Set([
          'node',
          imported.require ? 'require' : 'import',
        ]);
        if (imported.typeOnly || /\.(?:[cm]?tsx?|tsrx)$/u.test(file)) {
          const typeEntry = exportedEntry(
            record.manifest,
            declarationFallbackOwner
              ? `${installedName}${specifier.slice(name.length)}`
              : (octaneTypeOwner || imported.reference === 'types') &&
                  installedName !== name
                ? installedName
                : specifier,
            new Set([...conditions, 'types']),
          );
          if (typeEntry) {
            const typeFile = resolveTypeFile(
              path.resolve(record.directory, typeEntry),
              declarationFallbackOwner
                ? {
                    beforeRealpath: file => {
                      assert(
                        within(record.directory, file),
                        `Declaration fallback ${specifier} must select a contained declaration file`,
                      );
                      ordinaryConsumerFile(file, 'Declaration fallback target');
                    },
                  }
                : undefined,
            );
            assert(
              typeFile,
              `Missing selected declaration export ${specifier}`,
            );
            if (declarationFallbackOwner) {
              const candidate = path.resolve(record.directory, typeEntry);
              assert(
                (record.manifest.exports === undefined ||
                  typeEntry.startsWith('./')) &&
                  within(record.directory, candidate) &&
                  within(record.directory, typeFile) &&
                  /\.d\.[cm]?ts$/u.test(typeFile),
                `Declaration fallback ${specifier} must select a contained declaration file`,
              );
              let current = record.directory;
              for (const segment of path
                .relative(record.directory, candidate)
                .split(path.sep)) {
                current = path.join(current, segment);
                assert(
                  !fs
                    .lstatSync(current, { throwIfNoEntry: false })
                    ?.isSymbolicLink(),
                  `Declaration fallback ${specifier} contains a symbolic link`,
                );
              }
              ordinaryConsumerFile(typeFile, 'Declaration fallback target');
              const ownerManifest = ordinaryConsumerFile(
                path.join(declarationFallbackOwner.directory, 'package.json'),
                'Declaration fallback owner manifest',
              );
              const ownerBytes = fs.readFileSync(ownerManifest);
              const declaredSpecifier =
                declarationFallbackOwner.manifest.dependencies[installedName];
              assert(
                JSON.parse(ownerBytes).dependencies?.[installedName] ===
                  declaredSpecifier &&
                  (!declarationFallbackOwner.manifestSha256 ||
                    crypto
                      .createHash('sha256')
                      .update(ownerBytes)
                      .digest('hex') ===
                      declarationFallbackOwner.manifestSha256),
                'Declaration fallback owner changed during its static closure audit',
              );
              declarationFallbacks.push({
                specifier,
                source: path.relative(root, file),
                sourceSha256: scanned.get(file),
                owner: declarationFallbackOwner.manifest.name,
                ownerManifest: path.relative(root, ownerManifest),
                ownerManifestSha256: crypto
                  .createHash('sha256')
                  .update(ownerBytes)
                  .digest('hex'),
                dependencyBlock: 'dependencies',
                declaredSpecifier,
                provider: record.manifest.name,
                providerVersion: record.manifest.version,
                providerManifest: path.relative(
                  root,
                  path.join(record.directory, 'package.json'),
                ),
                providerManifestSha256: record.manifestSha256,
                target: path.relative(root, typeFile),
                targetSha256: crypto
                  .createHash('sha256')
                  .update(fs.readFileSync(typeFile))
                  .digest('hex'),
              });
            }
            if (octaneTypeOwner)
              assert(
                typeFile ===
                  authenticateDeclaration(record, '@types/react/index.d.ts')
                    .file,
                'Octane React import must resolve the authenticated index.d.ts declaration',
              );
            authenticateTypeEdge(file, typeFile, imported);
            if (octaneTypeOwner)
              permittedTypeImports.push({
                owner: 'octane',
                ownerVersion: typeEvidence().declaredScope.providerVersion,
                path: path.relative(root, file),
                sourceSha256: scanned.get(file),
                specifier,
                resolvedName: record.manifest.name,
                resolvedVersion: record.manifest.version,
                manifestSha256: record.manifestSha256,
                evidenceSha256: octaneTypeEvidenceSha256,
                line: imported.line,
                kind: 'import type namespace',
                targetPath: path.relative(root, typeFile),
                targetSha256:
                  authenticatedDeclarationFiles.get(typeFile)?.sha256,
              });
            enqueueFile(typeFile, role);
          } else
            assert(
              !imported.typeOnly && !declarationFallbackOwner,
              `No selected declaration export ${specifier}`,
            );
        }
        if (imported.typeOnly || /\.d\.[cm]?ts$/u.test(file)) continue;
        const selected = exportedEntry(record.manifest, specifier, conditions);
        assert(
          selected,
          `No selected export for ${specifier} in ${record.manifest.name}`,
        );
        target = resolveFile(path.resolve(record.directory, selected), {
          exact: record.manifest.exports !== undefined,
          ...(requireAnchor
            ? {
                beforeRealpath: selected =>
                  ordinaryConsumerFile(selected, 'createRequire target'),
              }
            : {}),
        });
      }
      if (!target && unresolvedHostRequire) {
        deferBuildLoad(file, imported, 'unresolved-require');
        continue;
      }
      assert(
        target,
        `Unresolved entry import ${specifier} in ${path.relative(root, file)}`,
      );
      if (/^registration\.(?:ts|mjs|js)$/u.test(path.basename(target))) {
        const sdk = producer?.artifacts.find(
          item => item.sourceName === '@modern-js/ultramodern-app-tools',
        );
        const targetOwner = promoteSelectedFileOwner(target);
        if (sdk && targetOwner?.manifest.name === sdk.targetName) {
          const authority = bindCompilerActivation();
          const registration = composedRegistrationForFile(authority, target);
          if (
            registration &&
            authority.selected.renderer !== registration.renderer
          ) {
            assert(
              authority.registries.has(file),
              'Inactive composed registration cannot be imported outside its authenticated registry',
            );
            verifiedComposedRegistrationOrigins.add(target);
          }
        }
      }
      if (
        /^renderer-compiler-activation\.(?:ts|mjs|js)$/u.test(
          path.basename(target),
        )
      ) {
        const targetOwner = promoteSelectedFileOwner(target);
        const sdk = producer?.artifacts.find(
          item => item.sourceName === '@modern-js/ultramodern-app-tools',
        );
        if (
          targetOwner?.manifest.name === sdk?.targetName &&
          activationDispatcherFormat(
            path
              .relative(targetOwner.directory, target)
              .split(path.sep)
              .join('/'),
          )
        ) {
          const authority = bindCompilerActivation();
          assert(
            authority.dispatchers.has(target) &&
              authority.compositions.has(file) &&
              compilerDispatcherCaller(
                source,
                file,
                nodeModuleAst({ strict: true }),
              ),
            'Private compiler dispatcher cannot be imported or escaped outside selected native composition',
          );
          verifiedCompilerDispatcherOrigins.add(target);
        }
      }
      authenticateTypeEdge(file, target, imported);
      if (requireAnchor) {
        if (requireAnchor.kind === 'package' && specifier.startsWith('.')) {
          const artifact = producer.artifacts.find(
            item => item.targetName === selectedOwner.manifest.name,
          );
          const selected = path
            .relative(selectedOwner.directory, target)
            .split(path.sep)
            .join('/');
          const targetHash = crypto
            .createHash('sha256')
            .update(fs.readFileSync(target))
            .digest('hex');
          assert(
            artifact.files.find(item => item.path === selected)?.sha256 ===
              targetHash,
            'Package createRequire target differs from authenticated bytes',
          );
        }
        ownedRequireAnchors.push({
          ...requireAnchor,
          specifier,
          target: path.relative(root, target),
          targetSha256: crypto
            .createHash('sha256')
            .update(fs.readFileSync(target))
            .digest('hex'),
        });
      }
      enqueueFile(target, role);
    }
  }
  drain();
  if (hostBuildEvidence) {
    for (const evidence of [
      ...hostBuildEvidence.roots,
      hostBuildEvidence.manifest,
    ]) {
      const file = ordinaryConsumerFile(
        path.resolve(root, evidence.path),
        'Host build bound evidence',
      );
      assert(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex') === evidence.sha256,
        'Host build evidence changed during its role audit',
      );
    }
  }
  for (const loader of ownedSelfExportLoaders) {
    for (const [relative, expected] of [
      [loader.source, loader.sourceSha256],
      [loader.ownerManifest, loader.ownerManifestSha256],
      [loader.target, loader.targetSha256],
    ]) {
      const file = ordinaryConsumerFile(
        path.resolve(root, relative),
        'Owning self-export evidence',
      );
      assert(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex') === expected,
        'Owning self-export evidence changed during its closure audit',
      );
    }
    assert(
      !loader.active ||
        (scanned.get(path.resolve(root, loader.target)) ===
          loader.targetSha256 &&
          (loader.role !== 'runtime' ||
            scannedRoles.get(path.resolve(root, loader.target)) === 'runtime')),
      'Active owning self-export target was not audited in its required source role',
    );
  }
  if (compilerActivation) {
    for (const evidence of [
      ...compilerActivation.files.values(),
      compilerActivation.manifest,
    ]) {
      const current = ordinaryConsumerFile(
        path.resolve(root, evidence.path),
        'Compiler activation bound evidence',
      );
      assert(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(current))
          .digest('hex') === evidence.sha256,
        'Compiler activation bound evidence changed during audit',
      );
    }
    for (const activation of ownedCompilerActivations)
      assert(
        !activation.target ||
          (scanned.get(path.resolve(root, activation.target)) ===
            activation.targetSha256 &&
            (activation.role !== 'runtime' ||
              scannedRoles.get(path.resolve(root, activation.target)) ===
                'runtime')),
        'Selected compiler activation target was not audited in its required source role',
      );
  }
  for (const anchor of ownedRequireAnchors) {
    for (const evidence of [
      { path: anchor.source, sha256: anchor.sourceSha256 },
      { path: anchor.target, sha256: anchor.targetSha256 },
      ...anchor.packageScopes,
      ...(anchor.sentinel ? [anchor.sentinel] : []),
    ]) {
      const file = ordinaryConsumerFile(
        path.resolve(root, evidence.path),
        'createRequire anchor evidence',
      );
      assert(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex') === evidence.sha256,
        'createRequire anchor evidence changed during its static closure audit',
      );
    }
    assert(
      scanned.get(path.resolve(root, anchor.target)) === anchor.targetSha256,
      'createRequire target changed or was omitted from its static closure audit',
    );
  }
  for (const fallback of declarationFallbacks) {
    for (const [filePath, expected] of [
      [fallback.source, fallback.sourceSha256],
      [fallback.ownerManifest, fallback.ownerManifestSha256],
      [fallback.providerManifest, fallback.providerManifestSha256],
      [fallback.target, fallback.targetSha256],
    ]) {
      const file = ordinaryConsumerFile(
        path.resolve(root, filePath),
        'Declaration fallback evidence',
      );
      assert(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex') === expected,
        'Declaration fallback evidence changed during its static closure audit',
      );
    }
    assert(
      scanned.get(path.resolve(root, fallback.target)) ===
        fallback.targetSha256,
      'Declaration fallback target changed or was omitted from its static closure audit',
    );
  }
  if (activeServerBuild) {
    const file = ordinaryConsumerFile(
      path.resolve(root, activeServerBuild.manifestPath),
      'Native renderer build manifest',
    );
    assert(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex') === activeServerBuild.manifestSha256,
      'Native renderer build manifest changed during its static closure audit',
    );
    for (const module of activeServerBuild.modules) {
      const target = ordinaryConsumerFile(
        path.resolve(root, module.path),
        'Native compiled server entry',
      );
      assert(
        scanned.get(target) === module.sha256 &&
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(target))
            .digest('hex') === module.sha256,
        'Native compiled server entry changed or was omitted from its static closure audit',
      );
    }
  }
  if (activeDevelopmentBuild) {
    const file = ordinaryConsumerFile(
      path.resolve(root, activeDevelopmentBuild.manifestPath),
      'Native development renderer manifest',
    );
    assert(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex') === activeDevelopmentBuild.manifestSha256,
      'Native development renderer manifest changed during its static declaration audit',
    );
  }
  if (permittedTypeDependencies.size > 0)
    assert(
      permittedTypeImports.length > 0,
      'Octane @types/react permission requires a selected type-only import from its exact owned native declarations',
    );
  for (const [name, identities] of tupleIdentities)
    for (const record of records.values())
      if (
        identities.has(record.manifest.name) &&
        reachability.get(record.directory)?.has('native')
      )
        assert(
          record.manifest.version === exactPackages[name],
          `Tested tuple ${name} has transitive installed drift: ${record.manifest.version}`,
        );
  for (const [file, scope] of moduleFormatScopes) {
    assert(
      fs.lstatSync(file).isFile() && within(root, fs.realpathSync(file)),
      'Module format scope requires an ordinary consumer manifest',
    );
    assert(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex') === scope.sha256,
      'Module format scope changed during its selected file audit',
    );
  }
  const closure = [...records.values()]
    .map(record => {
      const files = [];
      const fileGraph = [];
      const mappedFramework = record.manifest.name.startsWith(
        '@bleedingdev/modern-js-',
      );
      const sidecar = producerSidecars.has(record.manifest.name);
      const packedOwner = producer && (mappedFramework || sidecar);
      const ownerLabel = mappedFramework ? 'framework' : 'sidecar';
      const collect = directory => {
        for (const entry of fs.readdirSync(directory, {
          withFileTypes: true,
        })) {
          // Dependencies and package-manager bookkeeping in node_modules are
          // separate from the packed package's own files and audited above.
          if (entry.name === 'node_modules' && entry.isDirectory()) continue;
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) collect(absolute);
          else if (entry.isFile()) {
            const relative = path
              .relative(record.directory, absolute)
              .split(path.sep)
              .join('/');
            files.push(relative);
            if (packedOwner) {
              const bytes = fs.readFileSync(absolute);
              fileGraph.push({
                path: relative,
                size: bytes.length,
                sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
              });
            }
          } else if (packedOwner)
            assert(
              false,
              `Installed ${ownerLabel} package ${record.manifest.name} contains a non-regular packed file ${path.relative(record.directory, absolute)}`,
            );
        }
      };
      collect(record.directory);
      if (producer && record.manifest.name.startsWith('@modern-js/'))
        assert(
          false,
          `Installed framework package ${record.manifest.name} is outside the mapped producer artifact cohort`,
        );
      if (packedOwner) {
        const artifact =
          producerPackages.get(record.manifest.name) ??
          producerSidecars.get(record.manifest.name);
        assert(
          artifact && artifact.version === record.manifest.version,
          `Installed ${ownerLabel} package ${record.manifest.name}@${record.manifest.version} is outside the producer artifact cohort`,
        );
        const expectedFiles = new Map(
          artifact.files.map(file => [file.path, file]),
        );
        for (const file of fileGraph) {
          const expected = expectedFiles.get(file.path);
          assert(
            expected,
            `Installed ${ownerLabel} package ${record.manifest.name} contains an injected file ${file.path}`,
          );
          assert(
            file.size === expected.size && file.sha256 === expected.sha256,
            `Installed ${ownerLabel} package ${record.manifest.name} differs from candidate artifact bytes at ${file.path}`,
          );
          expectedFiles.delete(file.path);
        }
        assert(
          expectedFiles.size === 0,
          `Installed ${ownerLabel} package ${record.manifest.name} is missing candidate artifact files: ${[...expectedFiles.keys()].join(', ')}`,
        );
        fileGraph.sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        );
        (sidecar ? producerSidecarBindings : producerArtifactBindings).push({
          name: record.manifest.name,
          version: record.manifest.version,
          installedPath: path.relative(root, record.directory),
          sourceRevision: producer.sourceRevision,
          manifestSha256: producer.manifestSha256,
          frameworkCohortDigest: producer.cohortDigest,
          artifactSha256: artifact.sha256,
          integrity: artifact.integrity,
          fileGraphSha256: crypto
            .createHash('sha256')
            .update(JSON.stringify(fileGraph))
            .digest('hex'),
          files: fileGraph,
          ignoredDirectoryRule: 'node_modules dependency trees only',
        });
      }
      return {
        ...manifestFacts(record.manifest),
        path: path.relative(root, record.directory),
        manifestSha256: record.manifestSha256,
        exportTargets: mappedFramework
          ? auditExportFiles(record.manifest, files)
          : [],
      };
    })
    .sort((left, right) =>
      `${left.name}@${left.version}:${left.path}`.localeCompare(
        `${right.name}@${right.version}:${right.path}`,
      ),
    );
  return {
    renderer,
    applicationRoot: path.relative(root, appRoot) || '.',
    exactPackages: Object.fromEntries(
      Object.entries(exactPackages).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    testedProfile: testedProfile ?? null,
    moduleFormatScopes: [...moduleFormatScopes.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    declarationFallbacks: declarationFallbacks.sort((left, right) =>
      `${left.source}:${left.specifier}`.localeCompare(
        `${right.source}:${right.specifier}`,
      ),
    ),
    ownedRequireAnchors: ownedRequireAnchors.sort((left, right) =>
      `${left.source}:${left.line}`.localeCompare(
        `${right.source}:${right.line}`,
      ),
    ),
    closure: closure.filter(record =>
      reachability.get(path.resolve(root, record.path))?.has('native'),
    ),
    edges: edges.filter(edge => edge.scope === 'native'),
    authoringDevelopment: {
      qualification:
        'explicit-authoring-inputs-in-separate-workspace-root-devDependencies-only',
      roots: authoringRoots,
      closure: closure.filter(record => {
        const scopes = reachability.get(path.resolve(root, record.path));
        return scopes?.has('authoring') && !scopes.has('native');
      }),
      edges: edges
        .filter(edge => edge.scope === 'authoring')
        .map(edge => ({
          ...edge,
          targetReachability: reachability
            .get(path.resolve(root, edge.installedPath))
            ?.has('native')
            ? 'selected-native'
            : 'dev-only-authoring',
        })),
      missingOptional: authoringMissingOptional,
    },
    catalogBindings: [...catalogBindings.values()].sort((left, right) =>
      `${left.catalog}:${left.name}`.localeCompare(
        `${right.catalog}:${right.name}`,
      ),
    ),
    workspaceAliasBindings: [...workspaceAliasBindings.values()].sort(
      (left, right) => left.name.localeCompare(right.name),
    ),
    missingOptional,
    ownedCompilerActivations,
    ownedSelfExportLoaders,
    permittedTypeDependencies: [...permittedTypeDependencies.values()].sort(
      (left, right) => left.path.localeCompare(right.path),
    ),
    permittedTypeImports: permittedTypeImports.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    nativeTypeInterop: permittedTypeImports.length
      ? {
          evidencePath: octaneTypeEvidencePath,
          evidenceSha256: octaneTypeEvidenceSha256,
          permission: typeEvidence().declaredScope.permission,
          provider: typeEvidence().declaredScope.provider,
          providerVersion: typeEvidence().declaredScope.providerVersion,
          reactTypesVersion: typeEvidence().declaredScope.reactTypesVersion,
          runtimeReactAllowed: false,
          files: [...authenticatedDeclarationFiles.values()].sort(
            (left, right) => left.packagePath.localeCompare(right.packagePath),
          ),
          incomingEdges: authenticatedTypeEdges,
        }
      : null,
    hostBuild: hostBuildEvidence,
    hostMetadataValidators,
    unverifiedBuildLoads: unverifiedBuildLoads
      .filter(
        item =>
          scannedRoles.get(path.resolve(root, item.source)) === 'host-build',
      )
      .filter(
        (item, index, items) =>
          items.findIndex(
            other =>
              other.source === item.source &&
              other.line === item.line &&
              other.kind === item.kind,
          ) === index,
      ),
    buildEntryClosure: [...scanned]
      .filter(([file]) => scannedRoles.get(file) === 'host-build')
      .map(([file, sha256]) => ({ path: path.relative(root, file), sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    entryClosure: [...scanned]
      .filter(([file]) => scannedRoles.get(file) === 'runtime')
      .map(([file, sha256]) => ({ path: path.relative(root, file), sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    producerArtifactBindings: producerArtifactBindings.sort((left, right) =>
      left.installedPath.localeCompare(right.installedPath),
    ),
    producerSidecarBindings: producerSidecarBindings.sort((left, right) =>
      left.installedPath.localeCompare(right.installedPath),
    ),
    nativeCompilerProofs,
    ownedComputedServerLoaders,
    exportConditionExecution: 'required-separate-probe',
    nodeEngineExecution: 'required-separate-probe',
  };
}
