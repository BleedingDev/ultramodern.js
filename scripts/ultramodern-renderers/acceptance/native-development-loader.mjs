import { parseSync, traverse } from '@babel/core';

// This recognizes a declaration, not a running compiler checkpoint. The caller
// authenticates the entire module against its candidate tarball before admission.
const guards = [
  "import fs from 'node:fs/promises';",
  "import path from 'node:path';",
  "import { createHash,randomUUID } from 'node:crypto';",
  "import {pathToFileURL} from 'node:url';",
  "import {assertRendererIdentity} from 'CORE/identity';",
  "import {contentType} from '@modern-js/utils/mime-types';",
  "import { RENDERER_DEVELOPMENT_DIRECTORY,assertRendererBuildInputsUnchanged } from './native-build-manifest';",
  'function assetName(name) {',
  "    if (!name || name.includes('\\\\') || name.includes('\\0') || /[?#]/u.test(name) || /^[a-z]:/iu.test(name) || path.posix.isAbsolute(name) || name.split('/').some((part)=>!part || part === '.' || part === '..')) throw new Error(`Unsafe native development compiler asset: $" +
    '{name}`);',
  '    return name;',
  '}',
  'function sha256(bytes) {',
  "    return createHash('sha256').update(bytes).digest('hex');",
  '}',
  'function emittedBytes(result, name) {',
  '    assetName(name);',
  '    if (!result.compilation.getAsset(name)) throw new Error(`Native compilation did not emit $' +
    '{name}`);',
  '    const output = result.compilation.outputOptions.path;',
  '    const filesystem = result.compilation.compiler.outputFileSystem;',
  "    if (!output || !filesystem) throw new Error('Native development compilation has no output filesystem');",
  '    return new Promise((resolve, reject)=>{',
  '        filesystem.readFile(path.join(output, name), (error, bytes)=>{',
  '            if (error) return reject(error);',
  '            if (!bytes) return reject(new Error(`Missing emitted native asset $' +
    '{name}`));',
  '            resolve(Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes));',
  '        });',
  '    });',
  '}',
  'async function safeDirectory(directory) {',
  '    const parent = path.dirname(directory);',
  '    if (parent !== directory) await safeDirectory(parent);',
  '    try {',
  '        const stat = await fs.lstat(directory);',
  '        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Native development checkpoint directory conflicts: $' +
    '{directory}`);',
  '    } catch (error) {',
  "        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;",
  '        await fs.mkdir(directory);',
  '        const stat = await fs.lstat(directory);',
  "        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Native development checkpoint directory changed during creation');",
  '    }',
  '}',
  'async function writeExclusive(directory, name, bytes) {',
  '    const filename = path.join(directory, assetName(name));',
  '    await safeDirectory(path.dirname(filename));',
  '    await fs.writeFile(filename, bytes, {',
  "        flag: 'wx'",
  '    });',
  '    const stat = await fs.lstat(filename);',
  "    if (!stat.isFile() || stat.isSymbolicLink() || sha256(await fs.readFile(filename)) !== sha256(bytes)) throw new Error('Native development checkpoint bytes changed before validation');",
  '}',
  'class NativeDevelopment {',
  "constructor(options) { this.directory=path.join(options.distDirectory,RENDERER_DEVELOPMENT_DIRECTORY); this.lockFile=path.join(this.directory,'.native-development-owner.json'); const session=randomUUID(); this.lockBytes=Buffer.from(JSON.stringify({session,pid:process.pid})); this.checkpointRoot=path.join(this.directory,'compilations',session); }",
  'async complete(stats){',
  'const wave = this.wave;',
  "if (!wave) throw new Error('Native development completion has no owning input wave');",
  'this.assertCurrent(wave.epoch);',
  "if (stats.hasErrors()) throw new Error('Native development compilation failed');",
  "const results = 'stats' in stats ? stats.stats : [",
  '            stats',
  '        ];',
  'const names = results.map((result)=>result.compilation.name);',
  "if (names.some((name)=>!name) || new Set(names).size !== names.length) throw new Error('Native development requires unique actual compiler names');",
  "const client = results.find((result)=>result.compilation.name === 'client');",
  "const server = results.find((result)=>result.compilation.name === 'server');",
  "if (!client || !server || !client.compilation.hash || !server.compilation.hash) throw new Error('Native development requires completed client and server compilations');",
  "if (client.compilation.compiler.options.mode !== 'development' || server.compilation.compiler.options.mode !== 'development') throw new Error('Native development cannot publish a production compilation');",
  'const session = this.options.getSessionIdentities();',
  'await this.verifyOwned(this.lockFile, this.lockOwner);',
  'await this.verifyOwned(this.checkpointRoot, this.checkpointOwner, true);',
  'const generation = this.generation + 1;',
  'const checkpoint = path.join(this.checkpointRoot, `$' +
    '{generation}-$' +
    '{wave.epoch}-$' +
    '{server.compilation.hash}`);',
  'await safeDirectory(path.dirname(checkpoint));',
  'await fs.mkdir(checkpoint);',
  "const serverRoot = path.join(checkpoint, 'server');",
  'const serverAssets = server.compilation.getAssets();',
  "if (!serverAssets.some((asset)=>asset.name === 'package.json')) throw new Error('Native development requires the actual emitted server package format');",
  'for (const asset of serverAssets)await writeExclusive(serverRoot, asset.name, await emittedBytes(server, asset.name));',
  "const clientRoot = path.join(checkpoint, 'client');",
  'const retained = new Map();',
  'const publicPath = client.compilation.outputOptions.publicPath;',
  "if (typeof publicPath !== 'string' || publicPath === 'auto' || publicPath.startsWith('//') || /[?#\\\\\\0]/u.test(publicPath)) throw new Error('Native development immutable assets require an owning dev-server publicPath');",
  "const prefix = new URL(publicPath, 'http://native-dev.invalid');",
  "if (prefix.username || prefix.password || (publicPath.startsWith('/') ? prefix.origin !== 'http://native-dev.invalid' : !/^https?:\\/\\//u.test(publicPath) || prefix.origin !== this.devServerOrigin)) throw new Error('Native development immutable assets must use the actual owning dev server origin');",
  'for (const asset of client.compilation.getAssets()){',
  '            const bytes = await emittedBytes(client, asset.name);',
  '            await writeExclusive(clientRoot, asset.name, bytes);',
  '            // Exclude actual compiler document/manifest endpoints, retaining opaque',
  '            // JSON/HTML resources just like the rest of the emitted client closure.',
  '            if (this.mutableClientAssets.has(asset.name) || asset.info.hotModuleReplacement) continue;',
  '            const pathname = new URL(`$' +
    "{publicPath.endsWith('/') ? publicPath : `$" +
    '{publicPath}/`}$' +
    "{assetName(asset.name)}`, 'http://native-dev.invalid').pathname;",
  '            const digest = sha256(bytes);',
  '            const previous = retained.get(pathname) ?? this.retained.get(pathname);',
  '            if (previous && previous.digest !== digest) throw new Error(`Native development immutable asset filename conflicts: $' +
    '{pathname}`);',
  '            retained.set(pathname, {',
  '                bytes,',
  '                digest,',
  "                contentType: contentType(asset.name) || 'application/octet-stream'",
  '            });',
  '        }',
  "const assets = JSON.parse((await emittedBytes(client, 'renderer-assets.json')).toString());",
  'const entries = new Map();',
  'for (const [entryName, identity] of Object.entries(session.identities)) {',
  'const nativeManifest = JSON.parse((await emittedBytes(client, `$' +
    '{this.options.renderer}-module-manifest.$' +
    '{encodeURIComponent(entryName)}.json`)).toString());',
  "if (this.options.renderer === 'solid') (await import('@modern-js/renderer-solid/manifest')).validateSolidModuleManifest(nativeManifest, identity);",
  "            else (await import('@modern-js/renderer-octane/manifest')).validateOctaneModuleManifest(nativeManifest, identity, client.compilation.hash);",
  'const chunk = server.compilation.entrypoints.get(entryName)?.getEntrypointChunk();',
  'const files = chunk ? [',
  '                ...chunk.files',
  '            ].filter((filename)=>/\\.[cm]?js$/u.test(filename)) : [];',
  'if (files.length !== 1) throw new Error(`Native development entry $' +
    '{entryName} requires one actual emitted server module`);',
  'const loaded = await import(pathToFileURL(path.join(serverRoot, assetName(files[0]))).href);',
  'const exported = loaded.rendererIdentity ? loaded : loaded.default;',
  'assertRendererIdentity(exported?.rendererIdentity, identity);',
  "if (typeof exported?.nativeRequestHandler !== 'function' || typeof exported?.nativeCSRRequestHandler !== 'function') throw new Error(`Native development entry $" +
    '{entryName} is missing its native transport handlers`);',
  '}',
  'const completed = await this.options.resolveWaveInputs();',
  'this.assertCurrent(wave.epoch);',
  'this.assertSessionGraph(completed);',
  'assertRendererBuildInputsUnchanged(wave.inputs, completed);',
  '}',
  '}',
  '',
].join('\n');

function unwrap(item) {
  if (item?.isTSNonNullExpression()) return unwrap(item.get('expression'));
  if (item?.isSequenceExpression()) {
    const expressions = item.get('expressions');
    if (
      expressions.length !== 2 ||
      !expressions[0].isNumericLiteral({ value: 0 })
    )
      return undefined;
    return unwrap(expressions[1]);
  }
  return item;
}

function member(item, name) {
  return (
    (item?.isMemberExpression() || item?.isOptionalMemberExpression()) &&
    !item.node.computed &&
    item.node.property.name === name
  );
}

function requireModule(item) {
  return item?.isCallExpression() &&
    item.get('callee').isIdentifier({ name: 'require' }) &&
    !item.scope.getBinding('require') &&
    item.get('arguments').length === 1 &&
    item.get('arguments')[0].isStringLiteral()
    ? item.get('arguments')[0].node.value
    : undefined;
}

function external(item, seen = new Set()) {
  item = unwrap(item);
  if (!item?.node || seen.has(item.node)) return undefined;
  seen.add(item.node);
  const required = requireModule(item);
  if (required) return { module: required, name: '*' };
  if (item.isIdentifier()) {
    const binding = item.scope.getBinding(item.node.name);
    if (!binding?.constant) return undefined;
    const declaration = binding.path;
    if (declaration.isImportSpecifier())
      return {
        module: declaration.parentPath.node.source.value,
        name: declaration.node.imported.name,
      };
    if (
      declaration.isImportDefaultSpecifier() ||
      declaration.isImportNamespaceSpecifier()
    )
      return { module: declaration.parentPath.node.source.value, name: '*' };
    if (declaration.isVariableDeclarator())
      return external(declaration.get('init'), seen);
  }
  if (member(item, 'default')) {
    const root = external(item.get('object'), seen);
    if (root?.name === '*') return root;
  }
  if (item.isCallExpression()) {
    const callee = unwrap(item.get('callee'));
    const args = item.get('arguments');
    if (
      member(callee, 'n') &&
      callee.get('object').isIdentifier({ name: '__webpack_require__' })
    ) {
      const declaration = callee.scope.getBinding('__webpack_require__')?.path;
      if (
        declaration?.isVariableDeclarator() &&
        declaration.get('init').isObjectExpression() &&
        declaration.get('init.properties').length === 0 &&
        args.length === 1
      )
        return external(args[0], seen);
    }
    if (callee?.isIdentifier() && args.length === 0) {
      const declaration = callee.scope.getBinding(callee.node.name)?.path;
      if (
        declaration?.isVariableDeclarator() &&
        member(declaration.get('init.callee'), 'n')
      )
        return external(callee, seen);
    }
  }
  return undefined;
}

function externalRoot(item) {
  item = unwrap(item);
  return (
    external(item) ??
    (item?.isMemberExpression() || item?.isOptionalMemberExpression()
      ? externalRoot(item.get('object'))
      : undefined)
  );
}

const ignored = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'typeAnnotation',
  'returnType',
  'typeParameters',
  'typeArguments',
  'accessibility',
  'abstract',
  'declare',
  'readonly',
  'definite',
  'optional',
  'importKind',
  'exportKind',
]);

function canonical(item, coreName, aliases = {}) {
  item = unwrap(item);
  if (!item?.node) return null;
  const reference = external(item);
  if (reference) {
    let module =
      reference.module === `${coreName}/identity`
        ? 'CORE/identity'
        : reference.module.replace(/\.m?js$/u, '');
    for (const [name, target] of Object.entries(aliases)) {
      if (module === target || module.startsWith(`${target}/`)) {
        module = name + module.slice(target.length);
        break;
      }
    }
    return reference.name === '*'
      ? ['external', module]
      : ['MemberExpression', ['external', module], reference.name];
  }
  if (item.isStringLiteral()) {
    let value = item.node.value;
    for (const [name, target] of Object.entries(aliases)) {
      if (value === target || value.startsWith(`${target}/`)) {
        value = name + value.slice(target.length);
        break;
      }
    }
    return { type: 'StringLiteral', value };
  }
  if (item.isIdentifier()) {
    const binding = item.scope.getBinding(item.node.name);
    return ['Identifier', binding?.kind ?? 'global', item.node.name];
  }
  if (
    (item.isMemberExpression() || item.isOptionalMemberExpression()) &&
    !item.node.computed
  )
    return [
      item.node.type,
      canonical(item.get('object'), coreName, aliases),
      item.node.property.name,
      ...(item.node.optional ? [true] : []),
    ];
  if (
    item.isNewExpression() &&
    item.get('callee').isIdentifier({ name: 'Error' }) &&
    !item.scope.getBinding('Error')
  ) {
    const args = item.get('arguments');
    const safeMessage = value =>
      value.isStringLiteral() ||
      (value.isTemplateLiteral() &&
        value
          .get('expressions')
          .every(expression => expression.isIdentifier()));
    if (args.length === 1 && safeMessage(args[0]))
      return ['NewExpression', 'Error'];
  }
  const result = {};
  for (const [key, value] of Object.entries(item.node)) {
    if (
      ignored.has(key) ||
      value === undefined ||
      value === null ||
      value === false
    )
      continue;
    // An object key is a literal name even when an ESM import shares that name.
    if (
      key === 'key' &&
      item.isObjectProperty() &&
      !item.node.computed &&
      item.get('key').isIdentifier()
    )
      result[key] = { type: 'Identifier', name: value.name };
    else if (Array.isArray(value))
      result[key] = item
        .get(key)
        .map(child => canonical(child, coreName, aliases));
    else if (
      value &&
      typeof value === 'object' &&
      typeof value.type === 'string'
    )
      result[key] = canonical(item.get(key), coreName, aliases);
    else result[key] = value;
  }
  return result;
}

function parsedPaths(source) {
  const parsed = parseSync(source, {
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    parserOpts: { createImportExpressions: true },
  });
  const functions = new Map();
  let construction, complete, loop;
  traverse(parsed, {
    FunctionDeclaration(item) {
      functions.set(item.node.id.name, item);
    },
    ClassMethod(item) {
      if (item.node.key.name === 'constructor') construction = item;
      if (item.node.key.name === 'complete') complete = item;
    },
    ForOfStatement(item) {
      if (item.node.left.declarations?.[0]?.id?.type === 'ArrayPattern')
        loop = item;
    },
  });
  return { functions, construction, complete, loop };
}

const expected = parsedPaths(guards);

/** Exact owning source grammar; private checkpoint execution is a separate gate. */
export function nativeDevelopmentLoaderImport(importPath, aliases) {
  const coreName = aliases?.['@modern-js/renderer-core'];
  if (!coreName || !importPath?.isImportExpression() || importPath.node.options)
    return false;
  const complete = importPath.findParent(item => item.isClassMethod());
  const klass = complete?.parentPath;
  if (
    !complete?.isClassMethod() ||
    complete.node.key.name !== 'complete' ||
    !complete.node.async ||
    complete.node.static ||
    complete.get('params').length !== 1 ||
    !klass?.isClassBody()
  )
    return false;
  const construction = klass
    .get('body')
    .find(item => item.isClassMethod({ kind: 'constructor' }));
  if (!construction) return false;
  const same = (a, b) =>
    JSON.stringify(canonical(a, coreName, aliases)) ===
    JSON.stringify(canonical(b, 'CORE', aliases));
  const top = complete.get('body.body');
  const expectedTop = expected.complete.get('body.body');
  const prefix = expectedTop.slice(
    0,
    expectedTop.findIndex(item => item.node === expected.loop.node),
  );
  if (prefix.some((item, index) => !top[index] || !same(top[index], item)))
    return false;
  const suffix = expected.complete.get('body.body').slice(-4);
  const loop = importPath.findParent(item => item.isForOfStatement());
  if (
    !loop ||
    loop.parentPath.node !== complete.get('body').node ||
    !same(loop.get('left'), expected.loop.get('left')) ||
    !same(loop.get('right'), expected.loop.get('right'))
  )
    return false;
  const loopIndex = top.findIndex(item => item.node === loop.node);
  if (loopIndex !== prefix.length) return false;
  if (
    suffix.some(
      (item, index) =>
        !top[loopIndex + 1 + index] || !same(top[loopIndex + 1 + index], item),
    )
  )
    return false;
  const statements = loop.get('body.body');
  const declaration = importPath.findParent(item =>
    item.isVariableDeclarator(),
  );
  const statement = declaration?.parentPath;
  const index = statements.findIndex(item => item.node === statement?.node);
  const expectedStatements = expected.loop.get('body.body');
  if (
    index !== expectedStatements.length - 4 ||
    expectedStatements.some(
      (item, offset) => !statements[offset] || !same(statements[offset], item),
    )
  )
    return false;
  // These functions must be the very same lexical helpers used by the loader;
  // names alone do not authorize a stub, a shadow, or a disk fallback.
  for (const [name, guard] of expected.functions) {
    const binding = complete.scope.getBinding(name);
    if (
      !binding?.constant ||
      !binding.path.isFunctionDeclaration() ||
      !same(binding.path, guard)
    )
      return false;
  }
  const assignments = new Map();
  let unsafe = false;
  const program = klass.findParent(item => item.isProgram());
  program.traverse({
    AssignmentExpression(item) {
      const left = item.get('left');
      if (
        ['directory', 'checkpointRoot', 'lockFile', 'lockBytes'].some(name =>
          member(left, name),
        )
      ) {
        if (
          !left.get('object').isThisExpression() ||
          item.parentPath.parentPath.node !== construction.get('body').node ||
          assignments.has(left.node.property.name)
        )
          unsafe = true;
        assignments.set(left.node.property.name, item.parentPath);
      }
      if (externalRoot(left.get?.('object'))) unsafe = true;
    },
    UpdateExpression(item) {
      if (externalRoot(item.get('argument.object'))) unsafe = true;
    },
    UnaryExpression(item) {
      if (
        item.node.operator === 'delete' &&
        externalRoot(item.get('argument.object'))
      )
        unsafe = true;
    },
  });
  construction.traverse({
    ReturnStatement(item) {
      if (item.getFunctionParent()?.node === construction.node) unsafe = true;
    },
  });
  if (
    unsafe ||
    expected.construction.get('body.body').some(item => {
      if (item.isVariableDeclaration()) {
        const declaration = construction.scope.getBinding('session')?.path;
        return (
          !declaration?.isVariableDeclarator() ||
          declaration.parentPath.parentPath.node !==
            construction.get('body').node ||
          !same(declaration.parentPath, item)
        );
      }
      return !same(
        assignments.get(item.node.expression.left.property.name),
        item,
      );
    })
  )
    return false;
  return true;
}
