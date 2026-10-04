import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseSync, traverse } from '@babel/core';

const schema = 'ultramodern-native-compiler-activation';
const formats = {
  source: ['./src/', '.ts'],
  import: ['./dist/esm-node/', '.mjs'],
  require: ['./dist/cjs/', '.js'],
};

function assert(condition, message) {
  if (!condition) throw new Error(`Compiler activation ${message}`);
}

function parse(source, filename) {
  const ast = parseSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: 'unambiguous',
    parserOpts: { plugins: ['typescript'], createImportExpressions: true },
  });
  assert(ast, 'source has no syntax tree');
  return ast;
}

function plainAstShape(value) {
  if (Array.isArray(value)) return value.map(plainAstShape);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            'start',
            'end',
            'loc',
            'extra',
            'leadingComments',
            'trailingComments',
            'innerComments',
          ].includes(key),
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, plainAstShape(item)]),
  );
}

const owningUrlShimSource = `const value = function() { return "u" < typeof document ? new (require('url'.replace('', ''))).URL('file:' + __filename).href : document.currentScript && document.currentScript.src || new URL('main.js', document.baseURI).href; }();`;
let owningUrlShimShape;
function isOwningUrlShim(init) {
  if (
    !init?.isCallExpression() ||
    !['require', 'document', 'URL', '__filename'].every(
      name => !init.scope.getBinding(name),
    )
  )
    return false;
  owningUrlShimShape ??= JSON.stringify(
    plainAstShape(
      parse(owningUrlShimSource, 'owning-url-shim.cjs').program.body[0]
        .declarations[0].init,
    ),
  );
  return JSON.stringify(plainAstShape(init.node)) === owningUrlShimShape;
}

/** The complete emitted URL shim imports Node's builtin URL module only. */
export function owningModuleUrlBuiltin(call, primitiveUnchanged) {
  if (
    !call?.get('callee').isIdentifier({ name: 'require' }) ||
    call.scope.getBinding('require')
  )
    return false;
  const fn = call.findParent(item => item.isFunctionExpression());
  const init = fn?.parentPath;
  return Boolean(
    init &&
      init.isCallExpression() &&
      init.get('callee').node === fn.node &&
      isOwningUrlShim(init) &&
      ['require', 'document', 'URL', '__filename', 'String'].every(name =>
        primitiveUnchanged(init, name),
      ),
  );
}

function unwrap(value) {
  while (
    value?.isTSAsExpression() ||
    value?.isTSSatisfiesExpression() ||
    value?.isTSNonNullExpression()
  )
    value = value.get('expression');
  return value;
}

function variable(value) {
  value = unwrap(value);
  if (!value?.isIdentifier()) return value;
  const binding = value.scope.getBinding(value.node.name);
  assert(
    binding?.constant && binding.path.isVariableDeclarator(),
    'data binding is mutable or unknown',
  );
  return unwrap(binding.path.get('init'));
}

function properties(value, frozen = false) {
  value = variable(value);
  if (frozen) {
    assert(
      value?.isCallExpression() &&
        value.get('callee').isMemberExpression() &&
        !value.node.callee.computed &&
        value.get('callee.object').isIdentifier({ name: 'Object' }) &&
        !value.scope.getBinding('Object') &&
        value.get('callee.property').isIdentifier({ name: 'freeze' }) &&
        value.get('arguments').length === 1,
      'data must use the genuine immutable object contract',
    );
    value = unwrap(value.get('arguments')[0]);
  }
  assert(value?.isObjectExpression(), 'data must be an ordinary object');
  const result = new Map();
  for (const item of value.get('properties')) {
    assert(
      item.isObjectProperty() && !item.node.computed && !item.node.method,
      'data cannot contain computed keys, methods, or spreads',
    );
    const name = item.get('key').isIdentifier()
      ? item.node.key.name
      : item.node.key.value;
    assert(
      typeof name === 'string' && !result.has(name),
      'data keys must be unique static names',
    );
    result.set(name, unwrap(item.get('value')));
  }
  return result;
}

function literal(value) {
  value = unwrap(value);
  assert(
    value?.isStringLiteral() || value?.isNumericLiteral(),
    'field must be a literal',
  );
  return value.node.value;
}

function programBinding(ast, name, exported = false) {
  let program;
  traverse(ast, {
    Program(item) {
      program = item;
    },
  });
  const binding = program.scope.getBinding(name);
  assert(
    binding?.constant && binding.scope === program.scope,
    'owner must retain its program binding',
  );
  if (exported) {
    const declaration = binding.path.isVariableDeclarator()
      ? binding.path.parentPath
      : binding.path;
    const direct = declaration.parentPath.isExportNamedDeclaration();
    const named = program
      .get('body')
      .some(
        item =>
          item.isExportNamedDeclaration() &&
          !item.node.source &&
          item
            .get('specifiers')
            .some(
              specifier =>
                specifier.isExportSpecifier() &&
                specifier.get('local').isIdentifier({ name }) &&
                specifier.get('local').scope.getBinding(name) === binding &&
                specifier.get('exported').isIdentifier({ name }),
            ),
      );
    assert(direct || named, 'owner does not export its actual program binding');
  }
  return binding.path;
}

/** Join the actual file to the receipt captured after the owning build. */
export function observedCompilerBuild({ bytes, path, evidence, validated }) {
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assert(
    evidence &&
      evidence.path === path &&
      evidence.sha256 === sha256 &&
      evidence.byteLength === bytes.length &&
      evidence.value &&
      typeof evidence.value === 'object',
    'requires the independently observed completed-build evidence',
  );
  assert(
    isDeepStrictEqual(evidence.value, validated),
    'build differs from the observed owning emission',
  );
  return sha256;
}

function unchangedPrivateCall(call, syntax) {
  const callee = syntax.unwrap(call.get('callee'));
  const object = callee.isMemberExpression() ? callee.get('object') : callee;
  if (!object.isIdentifier()) return false;
  const binding = object.scope.getBinding(object.node.name);
  if (!binding?.constant || binding.referencePaths.length !== 1) return false;
  if (
    binding.path.isImportSpecifier() ||
    binding.path.isImportNamespaceSpecifier()
  )
    return binding.referencePaths[0].node === object.node;
  if (!binding.path.isVariableDeclarator()) return false;
  const init = binding.path.get('init');
  return (
    init.isCallExpression() &&
    init.get('callee').isIdentifier({ name: 'require' }) &&
    !init.scope.getBinding('require') &&
    init.get('arguments').length === 1 &&
    init.get('arguments')[0].isStringLiteral() &&
    binding.referencePaths[0].node === object.node
  );
}

/** Read the actual finite registry and immutable slots, without executing a compiler. */
export function readCompilerActivationCatalogue({ read, primitiveUnchanged }) {
  const registryPath = 'src/native-composition/renderer-registration.ts';
  const ast = parse(read(registryPath), registryPath);
  const catalogue = programBinding(ast, 'registrations');
  const selector = programBinding(ast, 'resolveRendererRegistration', true);
  assert(
    catalogue.isVariableDeclarator() && selector.isFunctionDeclaration(),
    'registry lacks its static catalogue or selector',
  );
  const catalogueBinding = catalogue.scope.getBinding(catalogue.node.id.name);
  assert(catalogueBinding?.constant, 'catalogue binding must be immutable');
  for (const reference of catalogueBinding.referencePaths) {
    if (reference.findParent(item => item.isTSTypeQuery())) continue;
    const member = reference.parentPath;
    const call = member.parentPath;
    assert(
      member.isMemberExpression() &&
        !member.node.computed &&
        member.get('object').node === reference.node &&
        call.isCallExpression() &&
        call.get('callee').node === member.node &&
        call.get('arguments').length === 1,
      'catalogue cannot be mutated or escape its finite selector',
    );
    const callback = call.get('arguments')[0];
    assert(
      callback.isArrowFunctionExpression() &&
        callback.get('params').length === 1 &&
        callback.get('params')[0].isIdentifier(),
      'catalogue projections must be finite callbacks',
    );
    const callbackBinding = callback.scope.getBinding(
      callback.node.params[0].name,
    );
    if (member.node.property.name === 'map') {
      const body = callback.get('body');
      assert(
        body.isMemberExpression() &&
          !body.node.computed &&
          body.node.property.name === 'renderer' &&
          body.get('object').scope.getBinding(body.node.object.name) ===
            callbackBinding,
        'catalogue metadata projection cannot execute arbitrary code',
      );
    } else {
      const body = callback.get('body');
      const owner = call.findParent(item => item.isFunctionDeclaration());
      assert(
        member.node.property.name === 'find' &&
          owner &&
          [
            'resolveRendererRegistration',
            'resolveNativeRendererAdapter',
          ].includes(owner.node.id.name) &&
          body.isBinaryExpression({ operator: '===' }) &&
          body.get('left').isMemberExpression() &&
          !body.node.left.computed &&
          body.node.left.property.name === 'renderer' &&
          body
            .get('left.object')
            .scope.getBinding(body.node.left.object.name) === callbackBinding &&
          body.get('right').isIdentifier() &&
          body.get('right').scope.getBinding(body.node.right.name)?.kind ===
            'param',
        'catalogue lookup cannot mutate or substitute the selected renderer',
      );
    }
  }
  const entries = unwrap(catalogue.get('init'));
  assert(
    entries.isArrayExpression() && entries.get('elements').length > 0,
    'catalogue must be a nonempty literal array',
  );
  const selectorBody = selector.get('body.body');
  const selected =
    selectorBody[0]?.isVariableDeclaration() &&
    selectorBody[0].get('declarations')[0];
  assert(
    selector.get('params').length === 1 &&
      selectorBody.length === 3 &&
      selected?.isVariableDeclarator() &&
      selected.get('init').isCallExpression() &&
      selected.get('init.callee').isMemberExpression() &&
      !selected.node.init.callee.computed &&
      selected
        .get('init.callee.object')
        .isIdentifier({ name: 'registrations' }) &&
      selected.get('init.callee.object').scope.getBinding('registrations') ===
        catalogueBinding &&
      selected.get('init.callee.property').isIdentifier({ name: 'find' }) &&
      selectorBody[1].isIfStatement() &&
      !selectorBody[1].node.alternate &&
      selectorBody[1].get('test').isUnaryExpression({ operator: '!' }) &&
      selectorBody[1].get('test.argument').node.name ===
        selected.node.id.name &&
      selectorBody[1].get('consequent').isThrowStatement() &&
      selectorBody[2].isReturnStatement() &&
      selectorBody[2].node.argument.name === selected.node.id.name,
    'selector must retain the finite fail-closed registration dispatch',
  );
  const predicate = selected.get('init.arguments')[0];
  const parameter = selector.get('params')[0];
  const argument = parameter.isAssignmentPattern()
    ? parameter.get('left')
    : parameter;
  assert(
    selected.get('init.arguments').length === 1 &&
      predicate?.isArrowFunctionExpression() &&
      predicate.get('params').length === 1 &&
      predicate.get('body').isBinaryExpression({ operator: '===' }) &&
      predicate.get('body.left').isMemberExpression() &&
      !predicate.node.body.left.computed &&
      predicate.node.body.left.property.name === 'renderer' &&
      predicate
        .get('body.left.object')
        .scope.getBinding(predicate.node.body.left.object.name) ===
        predicate.scope.getBinding(predicate.node.params[0].name) &&
      predicate
        .get('body.right')
        .scope.getBinding(predicate.node.body.right.name) ===
        argument.scope.getBinding(argument.node.name),
    'selector must compare the requested renderer to the catalogue renderer',
  );
  const records = [];
  const used = new Set();
  for (const entry of entries.get('elements')) {
    assert(
      entry.isIdentifier(),
      'catalogue entries must be static imported registrations',
    );
    const binding = entry.scope.getBinding(entry.node.name);
    assert(
      binding?.constant && binding.path.isImportSpecifier(),
      'catalogue entry must retain its imported owner',
    );
    const request = binding.path.parentPath.node.source.value;
    assert(
      /^\.\.\/renderers\/[A-Za-z0-9_-]+\/registration$/u.test(request),
      'registration owner must be a finite canonical module',
    );
    const ownerPath = `src/${request.slice(3)}.ts`;
    const owner = parse(read(ownerPath), ownerPath);
    const exportedName = binding.path.node.imported.name;
    const registration = programBinding(owner, exportedName, true);
    assert(
      registration.isVariableDeclarator(),
      'registration owner does not export its declared record',
    );
    const init = unwrap(registration.get('init'));
    const frozen = init.isCallExpression();
    const fields = properties(init, frozen);
    const renderer = literal(fields.get('renderer'));
    const kind = literal(fields.get('kind'));
    assert(
      typeof renderer === 'string' &&
        !used.has(renderer) &&
        ['native', 'composed'].includes(kind),
      'renderer records must be finite and unique',
    );
    used.add(renderer);
    if (kind === 'composed') {
      assert(
        !fields.has('nativeAdapter'),
        'composed registration cannot declare a native compiler',
      );
      const compose = fields.get('compose');
      assert(
        compose?.isIdentifier(),
        'composed registration must retain its private factory',
      );
      const factory = compose.scope.getBinding(compose.node.name);
      assert(
        factory?.constant &&
          factory.path.isFunctionDeclaration() &&
          factory.path.parentPath.isProgram() &&
          factory.referencePaths.length === 1 &&
          factory.referencePaths[0].node === compose.node,
        'composed factory cannot escape its actual registration',
      );
      const recordBinding = registration.scope.getBinding(exportedName);
      assert(
        recordBinding.referencePaths.every(
          reference =>
            (reference.node === registration.parentPath.parentPath.node &&
              reference.isExportNamedDeclaration()) ||
            (reference.parentPath.isExportSpecifier() &&
              reference.parentPath
                .get('local')
                .isIdentifier({ name: exportedName }) &&
              reference.parentPath
                .get('exported')
                .isIdentifier({ name: exportedName })),
        ),
        'composed registration cannot be mutated or escape its selector',
      );
      assert(
        binding.referencePaths.every(reference =>
          entries.get('elements').some(item => item.node === reference.node),
        ),
        'composed import cannot be mutated or escape its catalogue',
      );
      records.push({
        renderer,
        kind,
        registration: ownerPath,
        compose: compose.node.name,
      });
      continue;
    }
    assert(
      frozen && primitiveUnchanged(init, 'Object'),
      'native registration must preserve immutable Node object primitives',
    );
    const adapter = properties(fields.get('nativeAdapter'), true);
    assert(
      literal(adapter.get('renderer')) === renderer &&
        !adapter.has('createCompiler'),
      'native adapter must use declarative compiler data',
    );
    const slot = properties(adapter.get('compiler'), true);
    assert(
      slot.size === 6 &&
        [
          'schema',
          'version',
          'renderer',
          'operation',
          'module',
          'export',
        ].every(key => slot.has(key)),
      'slot must contain exactly its declared protocol fields',
    );
    assert(
      literal(slot.get('schema')) === schema &&
        literal(slot.get('version')) === 1 &&
        literal(slot.get('renderer')) === renderer &&
        literal(slot.get('operation')) === 'compiler',
      'slot identity conflicts with its native owner',
    );
    const modules = properties(slot.get('module'), true);
    assert(
      modules.size === 3 && Object.keys(formats).every(key => modules.has(key)),
      'slot module formats must be complete and exact',
    );
    const module = {};
    let stem;
    for (const [format, [prefix, suffix]] of Object.entries(formats)) {
      const target = literal(modules.get(format));
      assert(
        typeof target === 'string' &&
          target.startsWith(prefix) &&
          target.endsWith(suffix),
        'slot target must retain its canonical module format',
      );
      const candidate = target.slice(prefix.length, -suffix.length);
      assert(
        /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/u.test(
          candidate,
        ) &&
          (stem === undefined || candidate === stem),
        'slot formats must select one canonical compiler stem',
      );
      stem = candidate;
      module[format] = target.slice(2);
    }
    const factory = literal(slot.get('export'));
    assert(
      /^[$A-Z_a-z][$\w]*$/u.test(factory),
      'factory must be one static export name',
    );
    for (const target of Object.values(module)) read(target);
    const compiler = parse(read(module.source), module.source);
    programBinding(compiler, factory, true);
    records.push({
      renderer,
      kind,
      registration: ownerPath,
      module,
      export: factory,
    });
  }
  return records;
}

/** A private dispatcher is admitted only through the selected native composition. */
export function compilerDispatcherCaller(source, filename, syntax) {
  const ast = parse(source, filename);
  let dispatchBinding;
  const calls = [];
  traverse(ast, {
    ImportSpecifier(item) {
      if (item.node.imported.name === 'activateNativeRendererCompiler') {
        if (
          !/^\.\/renderer-compiler-activation(?:\.[cm]?js)?$/u.test(
            item.parentPath.node.source.value,
          )
        )
          return;
        dispatchBinding = item.scope.getBinding(item.node.local.name);
      }
    },
    CallExpression(item) {
      const callee = syntax.unwrap(item.get('callee'));
      if (
        !syntax.namedFunction(
          callee,
          'activateNativeRendererCompiler',
          './renderer-compiler-activation',
        ) &&
        !syntax.namedFunction(
          callee,
          'activateNativeRendererCompiler',
          './renderer-compiler-activation.js',
        ) &&
        !syntax.namedFunction(
          callee,
          'activateNativeRendererCompiler',
          './renderer-compiler-activation.mjs',
        )
      )
        return;
      calls.push(item);
    },
  });
  if (calls.length !== 1) return false;
  const call = calls[0];
  if (!unchangedPrivateCall(call, syntax)) return false;
  if (
    dispatchBinding &&
    (!dispatchBinding.constant || dispatchBinding.referencePaths.length !== 1)
  )
    return false;
  const args = call.get('arguments');
  if (
    args.length !== 2 ||
    !args[0].isIdentifier() ||
    !args[1].isObjectExpression()
  )
    return false;
  const renderer = args[0].scope.getBinding(args[0].node.name);
  if (!renderer?.constant || !renderer.path.isVariableDeclarator())
    return false;
  const init = renderer.path.get('init');
  if (
    !init.isMemberExpression() ||
    init.node.computed ||
    init.node.property.name !== 'renderer' ||
    !init.get('object').isIdentifier()
  )
    return false;
  const registration = init
    .get('object')
    .scope.getBinding(init.node.object.name);
  const nativeFunction = call.findParent(item => item.isFunctionDeclaration());
  if (
    !nativeFunction ||
    !nativeFunction.parentPath.isProgram() ||
    registration?.kind !== 'param' ||
    registration.path.node !== nativeFunction.node.params[0]
  )
    return false;
  const nativeBinding = nativeFunction.scope.parent.getBinding(
    nativeFunction.node.id.name,
  );
  if (!nativeBinding?.constant || nativeBinding.referencePaths.length !== 1)
    return false;
  const reference = nativeBinding.referencePaths[0];
  const invoke = reference.parentPath;
  if (
    !invoke.isCallExpression() ||
    invoke.get('callee').node !== reference.node ||
    invoke.get('arguments').length !== 2
  )
    return false;
  const selected = invoke.get('arguments')[0];
  if (!selected.isIdentifier()) return false;
  const selectedBinding = selected.scope.getBinding(selected.node.name);
  if (
    !selectedBinding?.constant ||
    !selectedBinding.path.isVariableDeclarator()
  )
    return false;
  const select = selectedBinding.path.get('init');
  if (
    !select.isCallExpression() ||
    (!syntax.namedFunction(
      syntax.unwrap(select.get('callee')),
      'resolveRendererRegistration',
      './renderer-registration',
    ) &&
      !syntax.namedFunction(
        syntax.unwrap(select.get('callee')),
        'resolveRendererRegistration',
        './renderer-registration.js',
      ) &&
      !syntax.namedFunction(
        syntax.unwrap(select.get('callee')),
        'resolveRendererRegistration',
        './renderer-registration.mjs',
      ))
  )
    return false;
  if (!unchangedPrivateCall(select, syntax)) return false;
  const branch = invoke.parentPath;
  if (
    !branch.isConditionalExpression() ||
    branch.get('consequent').node !== invoke.node
  )
    return false;
  const alternate = branch.get('alternate');
  const composed = alternate.isCallExpression() && alternate.get('callee');
  if (
    !composed?.isMemberExpression() ||
    composed.node.computed ||
    composed.node.property.name !== 'compose' ||
    !composed.get('object').isIdentifier() ||
    composed.get('object').scope.getBinding(composed.node.object.name) !==
      selectedBinding ||
    alternate.get('arguments').length !== 1 ||
    !syntax.sameBinding(
      alternate.get('arguments')[0],
      invoke.get('arguments')[1],
    )
  )
    return false;
  const test = branch.get('test');
  if (!test.isBinaryExpression({ operator: '===' })) return false;
  const kind = test.get('left').isMemberExpression()
    ? test.get('left')
    : test.get('right');
  const native =
    kind.node === test.node.left ? test.get('right') : test.get('left');
  if (
    !kind.isMemberExpression() ||
    kind.node.computed ||
    kind.node.property.name !== 'kind' ||
    !native.isStringLiteral({ value: 'native' }) ||
    !kind.get('object').isIdentifier() ||
    kind.get('object').scope.getBinding(kind.node.object.name) !==
      selectedBinding
  )
    return false;
  const selectionFunction = invoke.findParent(item =>
    item.isArrowFunctionExpression(),
  );
  if (!selectionFunction || select.get('arguments').length !== 1) return false;
  const input = select.get('arguments')[0];
  const parameter = selectionFunction.get('params')[0];
  const option = parameter?.isAssignmentPattern()
    ? parameter.get('left')
    : parameter;
  return Boolean(
    input.isMemberExpression() &&
      !input.node.computed &&
      input.node.property.name === 'renderer' &&
      input.get('object').isIdentifier() &&
      option?.isIdentifier() &&
      input.get('object').scope.getBinding(input.node.object.name) ===
        option.scope.getBinding(option.node.name),
  );
}

function functionShape(fn, syntax) {
  const roles = new Map();
  const special = new Map();
  const moduleName = value => value.replace(/\.[cm]?js$/u, '');
  const owningUrlShim = item => {
    const binding = item.scope.getBinding(item.node.name);
    if (!binding?.constant || !binding.path.isVariableDeclarator())
      return false;
    const init = binding.path.get('init');
    return isOwningUrlShim(init);
  };
  const owningUrl = item =>
    (item.isMemberExpression() &&
      !item.node.computed &&
      item.node.property.name === 'url' &&
      item.get('object').isMetaProperty() &&
      item.node.object.meta.name === 'import' &&
      item.node.object.property.name === 'meta') ||
    (item.isIdentifier() && owningUrlShim(item));
  const owningFilename = (item, seen = new Set()) => {
    if (seen.has(item.node)) return false;
    seen.add(item.node);
    if (item.isIdentifier()) {
      const binding = item.scope.getBinding(item.node.name);
      const program = item.scope.getProgramParent();
      if (!binding)
        return (
          item.node.name === '__filename' &&
          program.path.node.sourceType === 'script'
        );
      if (
        !binding.constant ||
        binding.scope !== program ||
        !binding.path.isVariableDeclarator() ||
        binding.referencePaths.length !== 1 ||
        binding.referencePaths[0].node !== item.node ||
        program.path.node.sourceType !== 'module'
      )
        return false;
      const init = binding.path.get('init');
      return init.isCallExpression() && owningFilename(init, seen);
    }
    if (item.isCallExpression()) {
      const args = item.get('arguments');
      return (
        syntax.namedFunction(
          syntax.unwrap(item.get('callee')),
          'fileURLToPath',
          'node:url',
        ) &&
        args.length === 1 &&
        owningUrl(args[0])
      );
    }
    if (!item.isConditionalExpression()) return false;
    const test = item.get('test');
    if (!test.isBinaryExpression({ operator: '===' })) return false;
    const type = test.get('left');
    return (
      type.isUnaryExpression({ operator: 'typeof' }) &&
      type.get('argument').isIdentifier({ name: '__filename' }) &&
      !type.scope.getBinding('__filename') &&
      test.get('right').isStringLiteral({ value: 'string' }) &&
      item.get('consequent').isIdentifier({ name: '__filename' }) &&
      !item.scope.getBinding('__filename') &&
      owningFilename(item.get('alternate'), seen)
    );
  };
  fn.traverse({
    Expression(item) {
      item = unwrap(item);
      // Rspack folds the source's Node-format filename branch to native
      // __filename in CJS, or an immutable fileURLToPath(import.meta.url) in ESM.
      if (owningFilename(item)) {
        special.set(item.node, { type: 'OwningModuleFilename' });
        item.skip();
        return;
      }
      if (
        item.isSequenceExpression() &&
        item.get('expressions').length === 2 &&
        item.get('expressions')[0].isNumericLiteral({ value: 0 })
      ) {
        special.set(item.node, { unwrapped: item.get('expressions')[1].node });
        return;
      }
      if (
        item.isMemberExpression() &&
        !item.node.computed &&
        item.node.property.name === 'url' &&
        item.get('object').isMetaProperty() &&
        item.node.object.meta.name === 'import' &&
        item.node.object.property.name === 'meta'
      ) {
        special.set(item.node, { type: 'OwningModuleUrl' });
        return;
      }
      if (
        item.isMemberExpression() &&
        !item.node.computed &&
        item.node.property.name === 'href'
      ) {
        const object = item.get('object');
        if (
          object.isCallExpression() &&
          syntax.namedFunction(
            syntax.unwrap(object.get('callee')),
            'pathToFileURL',
            'node:url',
          ) &&
          object.get('arguments').length === 1 &&
          object.get('arguments')[0].isIdentifier({ name: '__filename' }) &&
          !object.scope.getBinding('__filename')
        ) {
          special.set(item.node, { type: 'OwningModuleUrl' });
          return;
        }
      }
      if (item.isMemberExpression() && !item.node.computed) {
        const origin = syntax.origin(item.get('object'));
        if (origin)
          special.set(item.node, {
            type: 'ExternalMember',
            module: moduleName(origin),
            property: item.node.property.name,
          });
      } else if (item.isCallExpression()) {
        const origin = syntax.origin(item);
        if (origin)
          special.set(item.node, {
            type: 'ExternalModule',
            module: moduleName(origin),
          });
      }
    },
    Identifier(item) {
      if (!item.isReferencedIdentifier() && !item.isBindingIdentifier()) return;
      if (special.has(item.node)) return;
      if (item.isReferencedIdentifier() && owningFilename(item)) {
        special.set(item.node, { type: 'OwningModuleFilename' });
        return;
      }
      const binding = item.scope.getBinding(item.node.name);
      if (item.node.name === 'undefined' && !binding) {
        special.set(item.node, { type: 'UndefinedValue' });
        return;
      }
      if (item.isReferencedIdentifier() && owningUrlShim(item)) {
        special.set(item.node, { type: 'OwningModuleUrl' });
        return;
      }
      const origin = syntax.origin(item);
      if (origin) {
        special.set(
          item.node,
          binding?.path.isImportSpecifier()
            ? {
                type: 'ExternalMember',
                module: moduleName(origin),
                property: binding.path.node.imported.name,
              }
            : { type: 'ExternalModule', module: moduleName(origin) },
        );
      } else if (binding) {
        if (!roles.has(binding)) roles.set(binding, `local-${roles.size}`);
        special.set(item.node, {
          type: 'Identifier',
          name: roles.get(binding),
        });
      }
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
    'typeAnnotation',
    'typeParameters',
    'typeArguments',
    'returnType',
  ]);
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    if (
      [
        'TSAsExpression',
        'TSSatisfiesExpression',
        'TSNonNullExpression',
      ].includes(value.type)
    )
      return normalize(value.expression);
    if (
      value.type === 'UnaryExpression' &&
      value.operator === 'void' &&
      value.argument.type === 'NumericLiteral' &&
      value.argument.value === 0
    )
      return { type: 'UndefinedValue' };
    if (
      value.type === 'BinaryExpression' &&
      ['===', '!==', '==', '!='].includes(value.operator)
    ) {
      // SWC swaps literal comparisons and removes strictness only for typeof,
      // whose value is necessarily a primitive string.
      const typeComparison =
        [value.left, value.right].some(
          item => item.type === 'UnaryExpression' && item.operator === 'typeof',
        ) &&
        [value.left, value.right].some(item => item.type === 'StringLiteral');
      const operator = typeComparison
        ? value.operator.includes('!')
          ? '!=='
          : '==='
        : value.operator;
      const operands = [normalize(value.left), normalize(value.right)].sort(
        (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
      return { type: 'BinaryExpression', operator, operands };
    }
    if (special.has(value)) {
      const replacement = special.get(value);
      return replacement.unwrapped
        ? normalize(replacement.unwrapped)
        : replacement;
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, item]) =>
            !ignored.has(key) &&
            !(key === 'expression' && typeof item === 'boolean'),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  };
  return JSON.stringify(normalize(fn.node));
}

const dispatcherContract = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readRendererFrameworkPackage } from './renderer-installed-profile';
import { resolveRendererRegistration } from './renderer-registration';
export async function activateNativeRendererCompiler(renderer, options) {
  const registration = resolveRendererRegistration(renderer);
  if (registration.kind !== 'native') throw new Error(\`Renderer \${renderer} has no native compiler activation\`);
  const adapter = registration.nativeAdapter;
  const activation = adapter.compiler;
  if (!activation || !activation.module || registration.renderer !== renderer || registration.candidateProfile.renderer !== renderer || adapter.renderer !== renderer || adapter.profile.renderer !== renderer || activation.renderer !== renderer || activation.schema !== 'ultramodern-native-compiler-activation' || activation.version !== 1 || activation.operation !== 'compiler' || !Object.isFrozen(activation) || !Object.isFrozen(activation.module) || typeof activation.export !== 'string' || !/^[$A-Z_a-z][$\\w]*$/u.test(activation.export)) throw new Error(\`Invalid native compiler activation for \${renderer}\`);
  const entries = [['source','./src/','.ts'],['import','./dist/esm-node/','.mjs'],['require','./dist/cjs/','.js']];
  let compilerStem;
  for (const [format,prefix,suffix] of entries) {
    const entry = activation.module[format];
    if (typeof entry !== 'string' || !entry.startsWith(prefix) || !entry.endsWith(suffix)) throw new Error(\`Invalid \${format} compiler entry for \${renderer}\`);
    const stem = entry.slice(prefix.length,-suffix.length);
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/u.test(stem) || (compilerStem !== undefined && compilerStem !== stem)) throw new Error(\`Conflicting compiler module formats for \${renderer}\`);
    compilerStem = stem;
  }
  const filename = fs.realpathSync(typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url));
  const owner = readRendererFrameworkPackage({specifier:'@modern-js/ultramodern-app-tools',filename});
  const relativeFilename = path.relative(owner.directory,filename).split(path.sep).join('/');
  const format = relativeFilename === 'src/native-composition/renderer-compiler-activation.ts' || relativeFilename === 'dist/esm-node/native-composition/renderer-compiler-activation.mjs' ? 'import' : relativeFilename === 'dist/cjs/native-composition/renderer-compiler-activation.js' ? 'require' : undefined;
  if (!format) throw new Error('Native compiler dispatcher has no owning module format');
  const target = path.join(owner.directory,activation.module[format]);
  if (fs.realpathSync(target) !== target || !fs.statSync(target).isFile()) throw new Error(\`Native compiler entry is not owned by \${owner.name}\`);
  const compiler = await import(pathToFileURL(target).href);
  const factory = compiler[activation.export];
  if (typeof factory !== 'function') throw new Error(\`Native compiler \${renderer} does not export \${activation.export}\`);
  return factory(options);
}
`;

/** Compare the entire supported dispatcher, including all identity and path guards. */
export function compilerDispatcherImport(
  importPath,
  syntax,
  primitiveUnchanged,
) {
  const fn = importPath?.findParent(item => item.isFunctionDeclaration());
  if (
    !fn?.node.async ||
    fn.node.generator ||
    fn.node.id.name !== 'activateNativeRendererCompiler' ||
    fn.get('params').length !== 2 ||
    !primitiveUnchanged(fn, 'Object') ||
    !primitiveUnchanged(fn, '__filename')
  )
    return false;
  let privateCallsValid = true;
  fn.traverse({
    CallExpression(item) {
      const callee = syntax.unwrap(item.get('callee'));
      if (
        ['resolveRendererRegistration', 'readRendererFrameworkPackage'].some(
          name =>
            callee.isIdentifier({ name }) || syntax.property(callee, name),
        )
      )
        if (!unchangedPrivateCall(item, syntax)) privateCallsValid = false;
    },
  });
  if (!privateCallsValid) return false;
  const reference = parse(
    dispatcherContract,
    'compiler-activation-contract.ts',
  );
  let expected;
  traverse(reference, {
    FunctionDeclaration(item) {
      expected = item;
    },
  });
  return functionShape(fn, syntax) === functionShape(expected, syntax);
}

/** Admit only the complete own-package locator and its declared self export. */
export function owningSelfExportRequire(call, syntax, primitiveUnchanged) {
  const load = call?.parentPath;
  const fn = call?.findParent(item => item.isFunctionDeclaration());
  if (
    !load?.isCallExpression() ||
    load.get('callee').node !== call.node ||
    load.get('arguments').length !== 1 ||
    !fn ||
    !fn.parentPath.isProgram() ||
    fn.node.async ||
    fn.node.generator ||
    fn.get('params').length !== 1 ||
    ![
      'Object',
      'JSON',
      'String',
      '__filename',
      'require',
      'document',
      'URL',
    ].every(name => primitiveUnchanged(fn, name)) ||
    !syntax.namedFunction(
      syntax.unwrap(call.get('callee')),
      'createRequire',
      'node:module',
    ) ||
    call.get('arguments').length !== 1
  )
    return;
  const request = load.get('arguments')[0];
  if (
    !request.isTemplateLiteral() ||
    request.get('expressions').length !== 1 ||
    request.node.quasis.length !== 2 ||
    request.node.quasis[0].value.cooked !== ''
  )
    return;
  const suffix = request.node.quasis[1].value.cooked;
  if (
    !/^\/[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/u.test(
      suffix,
    )
  )
    return;
  const subpath = `.${suffix}`;
  let declaration = load.parentPath;
  while (
    declaration.isTSAsExpression() ||
    declaration.isTSSatisfiesExpression()
  )
    declaration = declaration.parentPath;
  if (
    !declaration.isVariableDeclarator() ||
    !declaration.get('id').isObjectPattern() ||
    declaration.get('id.properties').length !== 1
  )
    return;
  const property = declaration.get('id.properties')[0];
  if (
    !property.isObjectProperty() ||
    property.node.computed ||
    !property.get('key').isIdentifier() ||
    !property.get('value').isIdentifier()
  )
    return;
  const factory = property.node.key.name;
  const reference = parse(
    `
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
function compose(consumerPlugins) {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifestFile = path.join(directory, 'package.json');
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      if (typeof manifest.name !== 'string' || !manifest.exports?.[${JSON.stringify(subpath)}])
        throw new Error('The owning UltraModern package must export its selected React composition');
      const { ${factory} } = createRequire(import.meta.url)(\`\${manifest.name}${suffix}\`);
      return ${factory}({ consumerPlugins });
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Cannot find the owning UltraModern package for React composition');
    directory = parent;
  }
}
`,
    'owning-self-export-contract.ts',
  );
  let expected;
  traverse(reference, {
    FunctionDeclaration(item) {
      expected = item;
    },
  });
  if (functionShape(fn, syntax) !== functionShape(expected, syntax)) return;
  const anchor = call.get('arguments')[0];
  const lowered =
    anchor.isIdentifier() && anchor.scope.getBinding(anchor.node.name);
  if (
    lowered &&
    (!lowered.constant ||
      !lowered.path.isVariableDeclarator() ||
      !isOwningUrlShim(lowered.path.get('init')))
  )
    return;
  return {
    subpath,
    factory,
    functionName: fn.node.id.name,
    moduleUrl: lowered ? 'rslib-file-url' : 'import-meta-url',
  };
}
