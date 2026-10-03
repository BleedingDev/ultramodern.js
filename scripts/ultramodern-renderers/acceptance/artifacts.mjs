// Consumer: renderer packed-consumer and final release acceptance runners.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { parseSync, traverse } from '@babel/core';
import { parseDocument } from 'yaml';
import { repoRoot } from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/constants.mjs';
import {
  inspectNpmTarball,
  readVerifiedPackageArtifactBytes,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { readReleaseManifest } from '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';
import { nativeDevelopmentLoaderImport } from './native-development-loader.mjs';

const octaneTypeEvidencePath =
  'scripts/ultramodern-renderers/acceptance/evidence/octane-native-runtime-type-interop.json.txt';
const octaneTypeEvidenceSha256 =
  '2ba3502bc1d09a03d40af31bc6c09eedf6984781cb29c2df9788248bacb99cae';

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
  traverse(parsed, {
    ImportExpression(importPath) {
      dynamicImports.set(importPath.node.source, importPath);
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
    else if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      (/^(?:__)?require$/u.test(node.callee.name) ||
        additionalRequireNames.has(node.callee.name))
    )
      add(node.arguments[0], { require: true });
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

// Recognize one compiler-owned Node loader with its dominating path guards.
// Ownership and bytes are authenticated separately against the release tarball.
function nativeServerLoaderImport(importPath, aliases) {
  if (
    typeof aliases['@modern-js/utils'] !== 'string' ||
    typeof aliases['@modern-js/renderer-core'] !== 'string'
  )
    return false;
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
  const origin = (item, seen = new Set()) => {
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
        callee.isIdentifier({ name: 'require' }) &&
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
  const fileInit =
    filesDeclaration?.isVariableDeclarator() && filesDeclaration.get('init');
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
  const chunkInit =
    chunkDeclaration?.isVariableDeclarator() && chunkDeclaration.get('init');
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
  const identityCall =
    assertStatement?.isExpressionStatement() &&
    assertStatement.get('expression');
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
      'expression',
    ]);
    const normalize = node => {
      if (Array.isArray(node)) return node.map(normalize);
      if (!node || typeof node !== 'object') return node;
      if (node.type === 'BlockStatement' && node.body.length === 1)
        return normalize(node.body[0]);
      const entries = Object.entries(node).filter(([key]) => !ignored.has(key));
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
    if (typeof manifest[field] === 'string')
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
      release.sidecars?.packages.map(item => ({
        name: item.name,
        version: item.version,
        sha256: item.sha256,
        integrity: item.integrity,
      })) ?? [],
  };
}

function installedPackage(name, fromDirectory, consumerRoot) {
  const require = createRequire(path.join(fromDirectory, 'package.json'));
  for (const directory of require.resolve.paths(name) ?? []) {
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

function resolveFile(candidate, { exact = false } = {}) {
  if (exact)
    return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()
      ? fs.realpathSync(candidate)
      : undefined;
  for (const extension of extensions) {
    const file = `${candidate}${extension}`;
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      return fs.realpathSync(file);
  }
  for (const extension of extensions.slice(1)) {
    const file = path.join(candidate, `index${extension}`);
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      return fs.realpathSync(file);
  }
  return undefined;
}

function resolveTypeFile(candidate) {
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
    const resolved = resolveFile(`${stem}${suffix}`, { exact: true });
    if (resolved) return resolved;
  }
  return resolveFile(candidate);
}

/** Audits installed identities and static entry imports; execution is a separate gate. */
export function auditInstalledConsumer({
  consumerRoot,
  applicationRoot = '.',
  renderer,
  exactPackages,
  entryFiles,
  testedProfile,
  releaseArtifacts,
  nativeCompilerManifests,
  rendererBuildManifestPath,
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
  const producerArtifactBindings = [];
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
  const application = json(path.join(appRoot, 'package.json'));
  const workspace = json(path.join(root, 'package.json'));
  const contexts = [
    { directory: appRoot, manifest: application },
    ...(appRoot === root ? [] : [{ directory: root, manifest: workspace }]),
  ];
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
  let workspaceCatalog;
  const resolveSpecifier = (name, specifier, ownerDirectory) => {
    if (!String(specifier).startsWith('catalog:')) return { specifier };
    assert(
      contexts.some(context => context.directory === ownerDirectory),
      `Installed package ${name} leaks an unresolved catalog dependency`,
    );
    const catalog = /^catalog:([^:\s]*)$/u.exec(specifier)?.[1];
    assert(catalog !== undefined, `Invalid catalog dependency ${name}`);
    if (!workspaceCatalog) {
      const file = path.join(root, 'pnpm-workspace.yaml');
      assert(
        fs.lstatSync(file).isFile() && within(root, fs.realpathSync(file)),
        'Catalog dependencies require the ordinary owning workspace manifest',
      );
      const bytes = fs.readFileSync(file);
      const document = parseDocument(bytes.toString('utf8'), {
        uniqueKeys: true,
      });
      assert(document.errors.length === 0, 'Invalid owning workspace catalog');
      workspaceCatalog = {
        value: document.toJS({ maxAliasCount: 0 }),
        path: path.relative(root, file),
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    }
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
  const pendingFiles = entryFiles.map(file => {
    const resolved = resolveFile(path.resolve(root, file));
    assert(
      resolved && within(root, resolved),
      `Missing or external consumer entry ${file}`,
    );
    return resolved;
  });
  pendingFiles.push(...nativeEmittedEntries);
  const directedEntries = new Set(pendingFiles);
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
    pendingFiles.push(entry);
    return { ...installation, entry, exports: require(entry) };
  };
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
        pendingFiles.push(file);
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
      (!installedBoundary || containing.directory.length >= directory.length)
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
    if (scanned.has(file)) continue;
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
    scanned.set(file, crypto.createHash('sha256').update(bytes).digest('hex'));
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
    for (const imported of moduleSpecifiers(source, file)) {
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
            ? resolveTypeFile(path.resolve(path.dirname(file), specifier))
            : resolveFile(path.resolve(path.dirname(file), specifier));
      else {
        let installedName = octaneTypeOwner ? '@types/react' : name;
        let record = installedPackage(installedName, path.dirname(file), root);
        if (
          !record &&
          imported.reference === 'types' &&
          !name.startsWith('@types/')
        ) {
          installedName = `@types/${name.replace(/^@/u, '').replace('/', '__')}`;
          record = installedPackage(installedName, path.dirname(file), root);
        }
        assert(
          record,
          `Unresolved installed entry import ${specifier} in ${path.relative(root, file)}`,
        );
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
            (octaneTypeOwner || imported.reference === 'types') &&
              installedName !== name
              ? installedName
              : specifier,
            new Set([...conditions, 'types']),
          );
          if (typeEntry) {
            const typeFile = resolveTypeFile(
              path.resolve(record.directory, typeEntry),
            );
            assert(
              typeFile,
              `Missing selected declaration export ${specifier}`,
            );
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
            pendingFiles.push(typeFile);
          } else
            assert(
              !imported.typeOnly,
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
        });
      }
      assert(
        target,
        `Unresolved entry import ${specifier} in ${path.relative(root, file)}`,
      );
      authenticateTypeEdge(file, target, imported);
      pendingFiles.push(target);
    }
  }
  drain();
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
  const closure = [...records.values()]
    .map(record => {
      const files = [];
      const fileGraph = [];
      const mappedFramework = record.manifest.name.startsWith(
        '@bleedingdev/modern-js-',
      );
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
            if (producer && mappedFramework) {
              const bytes = fs.readFileSync(absolute);
              fileGraph.push({
                path: relative,
                size: bytes.length,
                sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
              });
            }
          } else if (producer && mappedFramework)
            assert(
              false,
              `Installed framework package ${record.manifest.name} contains a non-regular packed file ${path.relative(record.directory, absolute)}`,
            );
        }
      };
      collect(record.directory);
      if (producer && record.manifest.name.startsWith('@modern-js/'))
        assert(
          false,
          `Installed framework package ${record.manifest.name} is outside the mapped producer artifact cohort`,
        );
      if (producer && mappedFramework) {
        const artifact = producerPackages.get(record.manifest.name);
        assert(
          artifact && artifact.version === record.manifest.version,
          `Installed framework package ${record.manifest.name}@${record.manifest.version} is outside the producer artifact cohort`,
        );
        const expectedFiles = new Map(
          artifact.files.map(file => [file.path, file]),
        );
        for (const file of fileGraph) {
          const expected = expectedFiles.get(file.path);
          assert(
            expected,
            `Installed framework package ${record.manifest.name} contains an injected file ${file.path}`,
          );
          assert(
            file.size === expected.size && file.sha256 === expected.sha256,
            `Installed framework package ${record.manifest.name} differs from candidate artifact bytes at ${file.path}`,
          );
          expectedFiles.delete(file.path);
        }
        assert(
          expectedFiles.size === 0,
          `Installed framework package ${record.manifest.name} is missing candidate artifact files: ${[...expectedFiles.keys()].join(', ')}`,
        );
        fileGraph.sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        );
        producerArtifactBindings.push({
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
    missingOptional,
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
    entryClosure: [...scanned]
      .map(([file, sha256]) => ({ path: path.relative(root, file), sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    producerArtifactBindings: producerArtifactBindings.sort((left, right) =>
      left.installedPath.localeCompare(right.installedPath),
    ),
    nativeCompilerProofs,
    ownedComputedServerLoaders,
    exportConditionExecution: 'required-separate-probe',
    nodeEngineExecution: 'required-separate-probe',
  };
}
