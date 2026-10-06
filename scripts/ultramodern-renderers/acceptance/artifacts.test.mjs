import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseSync, traverse } from '@babel/core';
import {
  createTemplateRequiredFiles,
  repoRoot,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/constants.mjs';
import {
  createReleaseArtifacts,
  inspectNpmTarball,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { writeSidecarStagingManifest } from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/sidecars.mjs';
import {
  auditInstalledConsumer,
  auditReleaseArtifacts,
  compilerActivationAstAuthority,
  testedProfileTuple,
} from './artifacts.mjs';
import {
  compilerDispatcherCaller,
  compilerDispatcherImport,
  observedCompilerBuild,
  owningSelfExportRequire,
  readCompilerActivationCatalogue,
} from './compiler-activation-proof.mjs';

const sourceRevision = 'a'.repeat(40);
const version = '3.8.3-ultramodern.18';
const rendererPackage = '@bleedingdev/modern-js-renderer-solid';
const nativeVersion = '2.0.0-rc.13';
const compilerActivationOwner = path.join(
  repoRoot,
  'packages/solutions/ultramodern-app-tools',
);

function activationCatalogue(mutate = (_relative, source) => source) {
  const reads = [];
  const { primitiveUnchanged } = compilerActivationAstAuthority();
  const records = readCompilerActivationCatalogue({
    primitiveUnchanged,
    read(relative) {
      reads.push(relative);
      return mutate(
        relative,
        fs.readFileSync(path.join(compilerActivationOwner, relative), 'utf8'),
      );
    },
  });
  return { records, reads };
}

function dispatcherAccepted(source, filename) {
  const ast = parseSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: 'unambiguous',
    parserOpts: { plugins: ['typescript'], createImportExpressions: true },
  });
  const { syntax, primitiveUnchanged } = compilerActivationAstAuthority();
  const imports = [];
  traverse(ast, {
    ImportExpression(item) {
      imports.push(item);
    },
  });
  return (
    imports.length === 1 &&
    compilerDispatcherImport(imports[0], syntax, primitiveUnchanged)
  );
}

function selfExportDescriptors(source, filename) {
  const ast = parseSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: 'unambiguous',
    parserOpts: { plugins: ['typescript'], createImportExpressions: true },
  });
  const { syntax, primitiveUnchanged } = compilerActivationAstAuthority();
  const found = [];
  traverse(ast, {
    CallExpression(item) {
      const descriptor = owningSelfExportRequire(
        item,
        syntax,
        primitiveUnchanged,
      );
      if (descriptor) found.push(descriptor);
    },
  });
  return found;
}

test('owning self-export proof authenticates the complete real source, ESM, and CJS loader', () => {
  for (const relative of [
    'src/renderers/react/registration.ts',
    'dist/esm-node/renderers/react/registration.mjs',
    'dist/cjs/renderers/react/registration.js',
  ]) {
    const source = fs.readFileSync(
      path.join(compilerActivationOwner, relative),
      'utf8',
    );
    const descriptors = selfExportDescriptors(source, relative);
    assert.equal(descriptors.length, 1, relative);
    assert.deepEqual(descriptors[0], {
      subpath: './react-composition',
      factory: 'composeReactRenderer',
      functionName: 'compose',
      moduleUrl: relative.endsWith('.js')
        ? 'rslib-file-url'
        : 'import-meta-url',
    });
    for (const changed of [
      source.replace('directory = parent;', 'directory = directory;'),
      source.replace("!manifest.exports?.['./react-composition']", 'false'),
      source.replace(
        '`${manifest.name}/react-composition`',
        '`${process.env.OWNER}/react-composition`',
      ),
      source.replace(
        '`${manifest.name}/react-composition`',
        '`${manifest.name}/../foreign`',
      ),
      source.replace('for (;;)', 'return consumerPlugins; for (;;)'),
      source.replace('for(;;)', 'return consumerPlugins; for(;;)'),
    ].filter(changed => changed !== source))
      assert.equal(
        selfExportDescriptors(changed, relative).length,
        0,
        relative,
      );
    for (const statement of [
      'JSON.parse = () => ({name:"foreign",exports:{"./react-composition":true}});',
      'const alias = JSON; alias.parse = () => ({});',
      'const alias = String.prototype; alias.replace = () => "./foreign.cjs";',
      '__filename = "/foreign";',
    ])
      assert.equal(
        selfExportDescriptors(`${source}\n${statement}`, relative).length,
        0,
        statement,
      );
  }
  const source = fs.readFileSync(
    path.join(compilerActivationOwner, 'src/renderers/react/registration.ts'),
    'utf8',
  );
  assert.equal(
    compilerDispatcherCaller(
      fs
        .readFileSync(
          path.join(compilerActivationOwner, 'src/native-composition/index.ts'),
          'utf8',
        )
        .replace(
          'registration.compose(consumers, options.policy)',
          'unknownCompose(consumers, options.policy)',
        ),
      'index.ts',
      compilerActivationAstAuthority().syntax,
    ),
    false,
  );
  assert.throws(
    () =>
      activationCatalogue((relative, value) =>
        relative === 'src/renderers/react/registration.ts'
          ? `${value}\nreactRendererRegistration.kind = 'native';`
          : value,
      ),
    /composed registration cannot be mutated/u,
  );
  assert(selfExportDescriptors(source, 'registration.ts').length);
});

test('inline genuine createRequire resolve calls remain metadata while substituted or escaped factories fail', t => {
  const fixture = consumerFixture(t);
  const entry = path.join(fixture.root, 'src/entry.tsx');
  write(
    entry,
    "import { createRequire } from 'node:module';\nexport const filename = createRequire(import.meta.url).resolve('node:path');\n",
  );
  auditInstalledConsumer(fixture.options);
  for (const source of [
    "function createRequire(value) { return { resolve() { return value; } }; }\ncreateRequire(import.meta.url).resolve('react');\n",
    "import { createRequire } from 'node:module';\nconst resolve = createRequire(import.meta.url).resolve; resolve('react');\n",
    "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)['resolve']('react');\n",
    "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url).resolve = () => 'foreign';\n",
  ]) {
    write(entry, source);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /Unverifiable createRequire anchor/u,
    );
  }
});

test('a real packed owning self export resolves its require target and audits the complete helper closure', t => {
  const fixture = anchoredConsumerFixture(t, 'esm', undefined, true);
  assert.equal(
    execFileSync(
      process.execPath,
      [path.join(fixture.installed, 'dist/entry.mjs')],
      { cwd: fixture.root, encoding: 'utf8' },
    ).trim(),
    'true',
  );
  const report = auditInstalledConsumer(fixture.options);
  assert.equal(report.ownedSelfExportLoaders.length, 1);
  const loader = report.ownedSelfExportLoaders[0];
  assert.equal(loader.active, true);
  assert.equal(loader.subpath, './react-composition');
  assert.equal(
    loader.ownerManifestSha256,
    fileSha256(path.join(fixture.installed, 'package.json')),
  );
  assert.equal(
    loader.targetSha256,
    fileSha256(path.join(fixture.installed, 'src/private/helper.cjs')),
  );
  assert(
    report.entryClosure.some(file =>
      file.path.endsWith('src/private/deep.cjs'),
    ),
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        releaseArtifacts: undefined,
      }),
    /authenticated release ownership/u,
  );
  for (const relative of [
    'dist/entry.mjs',
    'src/private/helper.cjs',
    'package.json',
  ]) {
    const file = path.join(fixture.installed, relative);
    const bytes = fs.readFileSync(file);
    fs.appendFileSync(file, '\n');
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /differs from candidate artifact bytes|differs from authenticated/u,
    );
    write(file, bytes);
  }
});

test('self exports require exact require declarations and preserve forbidden or unresolved target dependencies', t => {
  for (const [mutation, expected] of [
    ['missing-self-export', /does not declare the exact self export/u],
    ['wrong-self-condition', /no canonical Node require target/u],
    ['forbidden-self-dependency', /forbidden React\/RSC module react/u],
    [
      'missing-self-dependency',
      /Unresolved installed entry import undeclared-self-runtime/u,
    ],
    ['foreign-root', /foreign or changed package scope/u],
  ]) {
    const fixture = anchoredConsumerFixture(t, 'esm', mutation, true);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      expected,
      mutation,
    );
  }
});

test('the complete emitted owning URL shim resolves builtin url and rejects prototype substitution', t => {
  const fixture = consumerFixture(t);
  const filename = 'dist/cjs/renderers/react/registration.js';
  const actual = fs.readFileSync(
    path.join(compilerActivationOwner, filename),
    'utf8',
  );
  const ast = parseSync(actual, {
    filename,
    babelrc: false,
    configFile: false,
  });
  const shim = ast.program.body.find(
    item =>
      item.type === 'VariableDeclaration' &&
      item.declarations[0].id.name === '__rslib_import_meta_url__',
  );
  assert(shim);
  const source = actual.slice(shim.start, shim.end);
  const entry = path.join(fixture.root, 'src/owning-url.cjs');
  const options = { ...fixture.options, entryFiles: ['src/owning-url.cjs'] };
  write(entry, `${source}\nmodule.exports = __rslib_import_meta_url__;\n`);
  auditInstalledConsumer(options);
  for (const changed of [
    `String.prototype.replace = () => './foreign.cjs';\n${source}`,
    `const alias = String.prototype; alias.replace = () => './foreign.cjs';\n${source}`,
    source.replace("'url'.replace('', '')", "'foreign'.replace('', '')"),
    `__filename = '/foreign';\n${source}`,
  ]) {
    write(entry, changed);
    assert.throws(
      () => auditInstalledConsumer(options),
      /Unverifiable computed module import/u,
    );
  }
});

test('actual compiler catalogue preserves composed metadata and authenticates every native format', () => {
  const { records, reads } = activationCatalogue();
  assert.deepEqual(
    records.map(record => [record.renderer, record.kind]),
    [
      ['react', 'composed'],
      ['solid', 'native'],
      ['octane', 'native'],
    ],
  );
  assert.equal(records[0].module, undefined);
  for (const record of records.filter(record => record.kind === 'native')) {
    assert.equal(Object.keys(record.module).length, 3);
    for (const target of Object.values(record.module))
      assert(reads.includes(target), target);
    assert(reads.includes(record.registration));
  }
});

test('compiler catalogue rejects mutable selectors, escaped catalogues, conflicting slots, and missing targets', () => {
  for (const change of [
    source => `${source}\nregistrations.reverse();`,
    source => `${source}\nregistrations.splice(0, 1);`,
    source => `${source}\nconsume(registrations);`,
    source => source.replace('return selected;', 'return registrations[0];'),
    source =>
      source.replace(
        'registration.renderer === value',
        'registration.renderer === "solid"',
      ),
    source =>
      source.replace(
        'solidRendererRegistration,',
        'solidRendererRegistration, solidRendererRegistration,',
      ),
  ]) {
    assert.throws(
      () =>
        activationCatalogue((relative, source) =>
          relative.endsWith('renderer-registration.ts')
            ? change(source)
            : source,
        ),
      /Compiler activation/u,
    );
  }
  for (const [before, after] of [
    ['version: 1', 'version: 2'],
    ["operation: 'compiler'", "operation: 'runtime'"],
    ["renderer: 'solid'", "renderer: 'foreign'"],
    ["'./src/renderers/solid/compiler/index.ts'", "'./src/../foreign.ts'"],
    [
      "'./dist/cjs/renderers/solid/compiler/index.js'",
      "'./dist/cjs/foreign/compiler/index.js'",
    ],
    ["export: 'pluginSolidRenderer'", "export: 'missingFactory'"],
    ['schema:', 'extra: true, schema:'],
    ['compiler: Object.freeze({', 'compiler: ({'],
  ]) {
    assert.throws(
      () =>
        activationCatalogue((relative, source) => {
          if (relative !== 'src/renderers/solid/registration.ts') return source;
          assert(source.includes(before), before);
          return source.replace(before, after);
        }),
      /Compiler activation/u,
      before,
    );
  }
  assert.throws(
    () =>
      activationCatalogue((relative, source) => {
        if (relative === 'dist/cjs/renderers/solid/compiler/index.js')
          throw new Error('Missing actual compiler target');
        return source;
      }),
    /Missing actual compiler target/u,
  );
});

test('catalogue reads the actual program exports instead of nested registration or selector decoys', () => {
  const baseline = activationCatalogue().records;
  const nested = activationCatalogue((relative, source) =>
    relative === 'src/renderers/solid/registration.ts'
      ? `${source}\nfunction decoy() { const solidRendererRegistration = { renderer: 'foreign', kind: 'composed' }; }`
      : relative.endsWith('renderer-registration.ts')
        ? `${source}\nfunction decoy() { const registrations = []; function resolveRendererRegistration() { return null; } }`
        : source,
  );
  assert.deepEqual(nested.records, baseline);
  assert.throws(
    () =>
      activationCatalogue((relative, source) =>
        relative === 'src/renderers/solid/registration.ts'
          ? source.replace(
              'export const solidRendererRegistration',
              'const solidRendererRegistration',
            )
          : source,
      ),
    /actual program binding/u,
  );
  assert.throws(
    () =>
      activationCatalogue((relative, source) =>
        relative === 'src/renderers/solid/compiler/index.ts'
          ? source.replace(
              'export function pluginSolidRenderer',
              'function pluginSolidRenderer',
            )
          : source,
      ),
    /actual program binding/u,
  );
});

test('actual source, ESM, and CJS composition retain selected private compiler dispatch', () => {
  for (const relative of [
    'src/native-composition/index.ts',
    'dist/esm-node/native-composition/index.mjs',
    'dist/cjs/native-composition/index.js',
  ]) {
    const source = fs.readFileSync(
      path.join(compilerActivationOwner, relative),
      'utf8',
    );
    assert(
      compilerDispatcherCaller(
        source,
        relative,
        compilerActivationAstAuthority().syntax,
      ),
      relative,
    );
  }
  const relative = 'src/native-composition/index.ts';
  const source = fs.readFileSync(
    path.join(compilerActivationOwner, relative),
    'utf8',
  );
  for (const [before, after] of [
    ['const renderer = registration.renderer;', "const renderer = 'foreign';"],
    ["registration.kind === 'native'", "registration.kind === 'composed'"],
    [
      'registration.compose(consumers, options.policy)',
      'registration.compose(consumers, {})',
    ],
    [
      'registration.compose(consumers, options.policy)',
      'registration.compose(consumers)',
    ],
    [
      'function composeNativeRenderer(',
      'export function composeNativeRenderer(',
    ],
    [
      'async function composeNativeRenderer(',
      'export async function composeNativeRenderer(',
    ],
  ].filter(([before]) => source.includes(before))) {
    assert.equal(
      compilerDispatcherCaller(
        source.replace(before, after),
        relative,
        compilerActivationAstAuthority().syntax,
      ),
      false,
      before,
    );
  }
  assert.equal(
    compilerDispatcherCaller(
      `${source}\nconst escaped = activateNativeRendererCompiler;`,
      relative,
      compilerActivationAstAuthority().syntax,
    ),
    false,
  );
});

test('real emitted dispatcher bodies preserve all guards across source, ESM, and CJS', () => {
  for (const relative of [
    'src/native-composition/renderer-compiler-activation.ts',
    'dist/esm-node/native-composition/renderer-compiler-activation.mjs',
    'dist/cjs/native-composition/renderer-compiler-activation.js',
  ]) {
    const source = fs.readFileSync(
      path.join(compilerActivationOwner, relative),
      'utf8',
    );
    assert(dispatcherAccepted(source, relative), relative);
    assert.equal(
      dispatcherAccepted(
        source.replace('compilerStem = stem;', 'compilerStem = renderer;'),
        relative,
      ),
      false,
      `Existing executable assignment remains authenticated in ${relative}`,
    );
    if (relative.endsWith('.mjs')) {
      const initializer = '__rspack_fileURLToPath(import.meta.url)';
      assert(source.includes(initializer));
      for (const changed of [
        source.replace(initializer, '"/foreign"'),
        source.replace(
          'fileURLToPath as __rspack_fileURLToPath',
          'pathToFileURL as __rspack_fileURLToPath',
        ),
        `${source}\n__rspack_import_meta_filename__ = "/foreign";`,
        `${source}\nconsume(__rspack_import_meta_filename__);`,
        source.replace('__rspack_import_meta_filename__);', '__filename);'),
      ])
        assert.equal(
          dispatcherAccepted(changed, relative),
          false,
          'Emitted ESM filename must retain its genuine immutable origin',
        );
    }
    if (relative.endsWith('.js')) {
      assert(source.includes('realpathSync(__filename)'));
      assert.equal(
        dispatcherAccepted(
          source.replace(
            'realpathSync(__filename)',
            'realpathSync("/foreign")',
          ),
          relative,
        ),
        false,
      );
      assert.equal(
        dispatcherAccepted(`${source}\n__filename = "/foreign";`, relative),
        false,
      );
    }
  }
});

test('dispatcher proof rejects weakened identity, executable substitutions, primitive mutation, and escaped selectors', () => {
  const relative = 'src/native-composition/renderer-compiler-activation.ts';
  const source = fs.readFileSync(
    path.join(compilerActivationOwner, relative),
    'utf8',
  );
  for (const [before, after] of [
    ['activation.version !== 1', 'activation.version !== 2'],
    ['!Object.isFrozen(activation)', 'false'],
    ['compilerStem = stem;', 'compilerStem = renderer;'],
    ['return (factory as', 'return (() => undefined as'],
    ["typeof factory !== 'function'", "typeof factory === 'function'"],
  ]) {
    assert(source.includes(before), before);
    assert.equal(
      dispatcherAccepted(source.replace(before, after), relative),
      false,
      before,
    );
  }
  for (const statement of [
    'fs.realpathSync = () => "/foreign";',
    'const alias = path; alias.join = () => "/foreign";',
    'const alias = Object; alias.isFrozen = () => true;',
    '__filename = "/foreign";',
    'const escaped = resolveRendererRegistration;',
  ])
    assert.equal(
      dispatcherAccepted(`${source}\n${statement}`, relative),
      false,
      statement,
    );
});

test('compiler selection joins immutable observed build bytes and opaque digests instead of accepting shape alone', () => {
  const value = {
    sourceRevision,
    profile: { renderer: 'react' },
    buildMarker: 'completed-owning-build',
    compilerDigest: '1'.repeat(64),
    inputDigest: '2'.repeat(64),
    frameworkCohortDigest: '3'.repeat(64),
    profileDigest: '4'.repeat(64),
  };
  const bytes = Buffer.from(JSON.stringify(value));
  const evidence = {
    path: 'dist/renderer-build.json',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    value: structuredClone(value),
  };
  assert.equal(
    observedCompilerBuild({
      bytes,
      path: evidence.path,
      evidence,
      validated: structuredClone(value),
    }),
    evidence.sha256,
  );
  for (const field of [
    'compilerDigest',
    'inputDigest',
    'frameworkCohortDigest',
    'profileDigest',
  ]) {
    const changed = { ...value, [field]: '0'.repeat(64) };
    assert.throws(
      () =>
        observedCompilerBuild({
          bytes: Buffer.from(JSON.stringify(changed)),
          path: evidence.path,
          evidence,
          validated: changed,
        }),
      /observed completed-build evidence/u,
      field,
    );
    assert.throws(
      () =>
        observedCompilerBuild({
          bytes,
          path: evidence.path,
          evidence,
          validated: changed,
        }),
      /observed owning emission/u,
      field,
    );
  }
  for (const change of [
    { path: 'foreign/renderer-build.json' },
    { sha256: '0'.repeat(64) },
    { byteLength: bytes.length + 1 },
    { value: null },
  ])
    assert.throws(
      () =>
        observedCompilerBuild({
          bytes,
          path: evidence.path,
          evidence: { ...evidence, ...change },
          validated: value,
        }),
      /observed completed-build evidence/u,
    );
});

test('direct private dispatcher entries cannot claim inactive compiler metadata admission', t => {
  const fixture = consumerFixture(t);
  const owner = path.join(fixture.root, 'node_modules', rendererPackage);
  const dispatcher = path.join(
    owner,
    'dist/esm-node/native-composition/renderer-compiler-activation.mjs',
  );
  write(
    dispatcher,
    'export async function activateNativeRendererCompiler(renderer, options) { return import(options.target); }\n',
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        entryFiles: [path.relative(fixture.root, dispatcher)],
      }),
    /no verified incoming selected composition/u,
  );
  // Reading an unselected slot is metadata only; ordinary direct compiler imports
  // still go through the complete runtime closure and its renderer denials.
  activationCatalogue();
  const target = path.join(owner, 'dist/compiler.mjs');
  write(target, "import 'react';\n");
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        entryFiles: [path.relative(fixture.root, target)],
      }),
    /forbidden React\/RSC module react/u,
  );
});
const typeInteropEvidencePath = path.join(
  repoRoot,
  'scripts/ultramodern-renderers/acceptance/evidence/octane-native-runtime-type-interop.json.txt',
);
const typeInteropEvidence = JSON.parse(
  fs.readFileSync(typeInteropEvidencePath, 'utf8'),
);
const octaneVersion = typeInteropEvidence.declaredScope.providerVersion;
const reactTypesVersion = typeInteropEvidence.declaredScope.reactTypesVersion;
const declarationFixtureRoot = path.join(
  repoRoot,
  'scripts/ultramodern-renderers/acceptance/test-fixtures/native-type-interop',
);
let frozenDeclarations;

function frozenTypeInteropDeclarations() {
  if (!frozenDeclarations) {
    assert.equal(
      fileSha256(typeInteropEvidencePath),
      '79e2eaa567552bffb96f656be0bf4c4eef7bd64d1b48316881e6967539495277',
    );
    const corpusPath = path.join(declarationFixtureRoot, 'corpus.json');
    assert.equal(
      fileSha256(corpusPath),
      'a644834409832dec28cadfaf925193dab0a1de0d0896e945e162f4c1e877b6e9',
    );
    const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
    assert.equal(corpus.authoritySha256, fileSha256(typeInteropEvidencePath));
    assert.equal(corpus.nativeSource.version, octaneVersion);
    assert.equal(corpus.reactTypes.version, reactTypesVersion);
    assert.equal(
      corpus.nativeSource.archiveSha256,
      typeInteropEvidence.nativeSourcePackage.sha256,
    );
    assert.equal(corpus.files.length, 91);
    // These exact published declarations exercise the scanner's type graph.
    // The corpus does not contain or qualify a native runtime implementation.
    frozenDeclarations = new Map();
    for (const file of [...corpus.files, ...corpus.licenses]) {
      const fixture = path.join(declarationFixtureRoot, file.file);
      assert(fs.lstatSync(fixture).isFile());
      const bytes = fs.readFileSync(fixture);
      assert.equal(bytes.length, file.size, file.file);
      assert.equal(fileSha256(fixture), file.sha256, file.file);
      if (file.packagePath) frozenDeclarations.set(file.packagePath, bytes);
    }
    for (const file of [
      ...typeInteropEvidence.nativeFiles,
      ...typeInteropEvidence.reactFiles,
    ]) {
      const bytes = frozenDeclarations.get(file.packagePath);
      assert.equal(bytes.length, file.size);
      assert.equal(
        crypto.createHash('sha256').update(bytes).digest('hex'),
        file.sha256,
      );
    }
  }
  return frozenDeclarations;
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fileSha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function ownedDirectory(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-artifacts-test-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function installFixture(
  root,
  name,
  manifest = {},
  contents = 'export const native = true;\n',
) {
  const directory = path.join(root, 'node_modules', name);
  writeJson(path.join(directory, 'package.json'), {
    name,
    version: name === 'solid-js' ? nativeVersion : version,
    type: 'module',
    exports: {
      '.': {
        types: './index.d.ts',
        import: './index.js',
        default: './index.js',
      },
    },
    engines: { node: '>=26.10.0' },
    ...manifest,
  });
  write(path.join(directory, 'index.js'), contents);
  write(
    path.join(directory, 'index.d.ts'),
    'export declare const native: boolean;\n',
  );
  return directory;
}

function consumerFixture(t, overrides = {}) {
  const root = ownedDirectory(t);
  writeJson(path.join(root, 'package.json'), {
    name: 'native-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@modern-js/renderer-solid': `npm:${rendererPackage}@${version}`,
    },
    ...overrides,
  });
  installFixture(root, rendererPackage, {
    peerDependencies: { 'solid-js': nativeVersion },
  });
  fs.mkdirSync(path.join(root, 'node_modules', '@modern-js'), {
    recursive: true,
  });
  fs.symlinkSync(
    path.join('..', '@bleedingdev', 'modern-js-renderer-solid'),
    path.join(root, 'node_modules', '@modern-js', 'renderer-solid'),
  );
  installFixture(root, 'solid-js');
  write(
    path.join(root, 'src', 'entry.tsx'),
    "import { native } from '@modern-js/renderer-solid';\nvoid native;\n",
  );
  write(
    path.join(root, 'dist', 'server.mjs'),
    "export { native } from '@modern-js/renderer-solid';\n",
  );
  return {
    root,
    options: {
      consumerRoot: root,
      renderer: 'solid',
      exactPackages: { [rendererPackage]: version },
      entryFiles: ['src/entry.tsx', 'dist/server.mjs'],
    },
  };
}

test('legacy package root directory requires select main while ESM and exports stay strict', t => {
  for (const mode of [
    'main',
    'default-index',
    'esm-denied',
    'exports-denied',
  ]) {
    const { root, options } = consumerFixture(t);
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.dependencies['legacy-directory'] = version;
    writeJson(manifestPath, manifest);
    const owner = installFixture(
      root,
      'legacy-directory',
      {
        type: 'commonjs',
        exports:
          mode === 'exports-denied' ? { '.': './lib/main.cjs' } : undefined,
        main: mode === 'default-index' ? undefined : './lib/main.cjs',
        module: './wrong-module.mjs',
      },
      'module.exports = { native: true };\n',
    );
    write(
      path.join(owner, 'lib/main.cjs'),
      'module.exports = { native: true };\n',
    );
    write(
      path.join(owner, 'wrong-module.mjs'),
      'throw new Error("Wrong legacy main selection");\n',
    );
    const entry = `src/directory-entry.${mode === 'esm-denied' ? 'mjs' : 'cjs'}`;
    write(
      path.join(root, entry),
      mode === 'esm-denied'
        ? "import value from 'legacy-directory/'; if (!value.native) throw new Error('Wrong directory target');\n"
        : "const value = require('legacy-directory/'); if (!value.native) throw new Error('Wrong directory target');\n",
    );
    const input = { ...options, entryFiles: [...options.entryFiles, entry] };
    if (mode.endsWith('denied')) {
      assert.throws(
        () =>
          execFileSync(process.execPath, [path.join(root, entry)], {
            cwd: root,
            stdio: 'pipe',
          }),
        mode === 'esm-denied'
          ? /ERR_UNSUPPORTED_DIR_IMPORT/u
          : /ERR_PACKAGE_PATH_NOT_EXPORTED/u,
      );
      assert.throws(
        () => auditInstalledConsumer(input),
        /No selected export for legacy-directory\//u,
      );
    } else {
      const target = path.join(
        owner,
        mode === 'main' ? 'lib/main.cjs' : 'index.js',
      );
      execFileSync(
        process.execPath,
        [
          '--eval',
          `const assert = require('node:assert/strict'); assert.equal(require.resolve('legacy-directory/'), ${JSON.stringify(target)}); require(${JSON.stringify(path.join(root, entry))});`,
        ],
        { cwd: root, stdio: 'pipe' },
      );
      const report = auditInstalledConsumer(input);
      assert(
        report.entryClosure.some(
          item =>
            item.path === path.relative(root, target) &&
            item.sha256 === fileSha256(target),
        ),
        mode,
      );
      assert(
        !report.entryClosure.some(
          item =>
            item.path ===
            path.relative(root, path.join(owner, 'wrong-module.mjs')),
        ),
        mode,
      );
    }
  }
});

test('package imports maps preserve owning scopes, Node conditions, and strict target closure', t => {
  for (const mode of [
    'import',
    'require',
    'wildcard',
    'denied',
    'missing-map',
    'missing-key',
    'missing-target',
    'escape',
    'symlink',
    'forbidden',
  ]) {
    const { root, options } = consumerFixture(t);
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.dependencies['imports-owner'] = version;
    writeJson(manifestPath, manifest);
    const imports = {
      '#identifier': {
        browser: './absent-browser.mjs',
        import: './esm.mjs',
        require: './cjs.cjs',
        default: './esm.mjs',
      },
      '#features/*': './features/*.mjs',
    };
    if (mode === 'denied')
      imports['#identifier'] = { import: null, default: './esm.mjs' };
    if (mode === 'missing-key') delete imports['#identifier'];
    if (mode === 'missing-target') imports['#identifier'] = './absent.mjs';
    if (mode === 'escape') imports['#identifier'] = './../outside.mjs';
    if (mode === 'symlink') imports['#identifier'] = './linked.mjs';
    if (mode === 'forbidden') imports['#identifier'] = './forbidden.mjs';
    const owner = installFixture(root, 'imports-owner', {
      exports: { '.': { import: './entry.mjs', require: './entry.cjs' } },
      ...(mode === 'missing-map' ? {} : { imports }),
    });
    write(
      path.join(owner, 'entry.mjs'),
      mode === 'wildcard'
        ? "export { value } from '#features/first';\n"
        : "export { value } from '#identifier';\n",
    );
    write(
      path.join(owner, 'entry.cjs'),
      "module.exports = require('#identifier');\n",
    );
    write(path.join(owner, 'esm.mjs'), 'export const value = true;\n');
    write(path.join(owner, 'cjs.cjs'), 'module.exports = { value: true };\n');
    write(
      path.join(owner, 'features/first.mjs'),
      'export const value = true;\n',
    );
    write(
      path.join(owner, 'forbidden.mjs'),
      "export { default as value } from 'react';\n",
    );
    if (mode === 'symlink')
      fs.symlinkSync('./esm.mjs', path.join(owner, 'linked.mjs'));
    const entry = `src/imports-entry.${mode === 'require' ? 'cjs' : 'mjs'}`;
    write(
      path.join(root, entry),
      mode === 'require'
        ? "const { value } = require('imports-owner'); if (value !== true) throw new Error('Wrong Node require target');\n"
        : "import { value } from 'imports-owner'; if (value !== true) throw new Error('Wrong Node import target');\n",
    );
    const input = { ...options, entryFiles: [...options.entryFiles, entry] };
    if (['import', 'require', 'wildcard'].includes(mode)) {
      execFileSync(process.execPath, [path.join(root, entry)], {
        cwd: root,
        stdio: 'pipe',
      });
      const report = auditInstalledConsumer(input);
      const selected =
        mode === 'require'
          ? 'cjs.cjs'
          : mode === 'wildcard'
            ? 'features/first.mjs'
            : 'esm.mjs';
      const target = path.join(owner, selected);
      assert(
        report.entryClosure.some(
          item =>
            item.path === path.relative(root, target) &&
            item.sha256 === fileSha256(target),
        ),
        mode,
      );
      assert(
        !report.entryClosure.some(
          item =>
            item.path ===
            path.relative(
              root,
              path.join(owner, mode === 'require' ? 'esm.mjs' : 'cjs.cjs'),
            ),
        ),
        mode,
      );
      assert.deepEqual(report.packageImportScopes, [
        {
          path: path.relative(root, path.join(owner, 'package.json')),
          sha256: fileSha256(path.join(owner, 'package.json')),
        },
      ]);
    } else
      assert.throws(
        () => auditInstalledConsumer(input),
        {
          denied: /No selected package import/u,
          'missing-map': /No selected package import/u,
          'missing-key': /No selected package import/u,
          'missing-target': /Unresolved entry import/u,
          escape: /Package imports target escapes/u,
          symlink: /contains a symbolic link/u,
          forbidden: /forbidden React\/RSC module react/u,
        }[mode],
        mode,
      );
  }
});

function declarationConsumerFixture(t, specifier = 'declaration-model') {
  const { root, options } = consumerFixture(t);
  const workspacePath = path.join(root, 'package.json');
  const workspace = JSON.parse(fs.readFileSync(workspacePath));
  workspace.dependencies['declaration-owner'] = version;
  writeJson(workspacePath, workspace);
  const providerName = `@types/${specifier.replace(/^@/u, '').replace('/', '__')}`;
  const owner = installFixture(root, 'declaration-owner', {
    dependencies: { [providerName]: '1.2.3' },
  });
  const source = path.join(owner, 'index.d.ts');
  write(
    source,
    `import { Model } from '${specifier}';\nexport declare const native: Model;\n`,
  );
  const provider = installFixture(owner, providerName, {
    version: '1.2.3',
    types: './index.d.ts',
    exports: { '.': { types: './index.d.ts' } },
  });
  const target = path.join(provider, 'index.d.ts');
  write(target, 'export interface Model { native: boolean }\n');
  write(
    path.join(root, 'src/entry.tsx'),
    "import { native } from 'declaration-owner';\nvoid native;\n",
  );
  return { root, options, owner, provider, providerName, source, target };
}

function hostBuildConsumerFixture(
  t,
  { computed = true, unprovenAnchor = false, unresolvedRequire = false } = {},
) {
  const fixture = consumerFixture(t);
  const { root } = fixture;
  const config = path.join(root, 'modern.config.mjs');
  write(
    config,
    "import config from './src/build-tool.cjs';\nexport default config;\n",
  );
  write(
    path.join(root, 'src/build-tool.cjs'),
    "module.exports = require('./build-leaf.cjs');\n",
  );
  write(
    path.join(root, 'src/build-leaf.cjs'),
    unprovenAnchor
      ? "const nodeModule = require('node:module');\nconst load = nodeModule.createRequire(__filename);\nconst loaders = { cjs: load };\nmodule.exports = load('./host-input.json');\n"
      : unresolvedRequire
        ? "try { require('missing-host-adapter'); } catch {}\nmodule.exports = require('./host-input.json');\n"
        : computed
          ? "const request = './host-input.json';\nmodule.exports = require(request);\n"
          : "module.exports = require('./host-input.json');\n",
  );
  writeJson(path.join(root, 'src/host-input.json'), { native: true });
  const value = {
    schema: 'ultramodern-renderer-build',
    version: 1,
    profile: { renderer: 'solid' },
    sourceRevision,
    buildMarker: '1'.repeat(64),
    promotable: true,
  };
  // A real small host command executes the fixture config and publishes its
  // completed fixture metadata; this is a unit control, not compiler acceptance.
  const args = [
    '--input-type=module',
    '--eval',
    `import config from './modern.config.mjs';
import fs from 'node:fs';
if (config.native !== true) throw new Error('Host config was not executed');
fs.writeFileSync('dist/renderer-build.json', ${JSON.stringify(JSON.stringify(value))});
`,
  ];
  execFileSync(process.execPath, args, { cwd: root, stdio: 'pipe' });
  const metadata = path.join(root, 'dist/renderer-build.json');
  const evidence = file => ({
    path: path.relative(root, file),
    sha256: fileSha256(file),
    byteLength: fs.statSync(file).size,
  });
  return {
    ...fixture,
    config,
    options: {
      ...fixture.options,
      buildEntryFiles: [{ ...evidence(config), purpose: 'configuration' }],
      buildCommandEvidence: {
        phase: 'build',
        command: process.execPath,
        cwd: root,
        args,
        exitCode: 0,
      },
      rendererBuildManifestPath: path.relative(root, metadata),
      rendererBuildEvidence: { ...evidence(metadata), value },
    },
  };
}

test('actual host inputs join a completed command and emission while disclosing dynamic loads', t => {
  const fixture = hostBuildConsumerFixture(t);
  const report = auditInstalledConsumer(fixture.options);
  assert.equal(report.hostBuild.command.exitCode, 0);
  assert.equal(
    report.hostBuild.manifest.sha256,
    fixture.options.rendererBuildEvidence.sha256,
  );
  assert.deepEqual(
    report.buildEntryClosure.map(item => item.path),
    ['modern.config.mjs', 'src/build-leaf.cjs', 'src/build-tool.cjs'],
  );
  assert.equal(report.unverifiedBuildLoads.length, 1);
  assert.deepEqual(report.unverifiedBuildLoads[0], {
    source: 'src/build-leaf.cjs',
    sourceSha256: fileSha256(path.join(fixture.root, 'src/build-leaf.cjs')),
    line: 2,
    specifier: null,
    kind: 'computed-require',
    admission: 'unverified-host-build-load',
  });
  assert(report.entryClosure.some(item => item.path === 'dist/server.mjs'));
  assert(!report.entryClosure.some(item => item.path === 'src/build-leaf.cjs'));
});

test('default, overlapping, and directly imported runtime roots cannot use host admission', t => {
  const fixture = hostBuildConsumerFixture(t);
  for (const options of [
    {
      ...fixture.options,
      buildEntryFiles: [],
      entryFiles: ['modern.config.mjs'],
    },
    {
      ...fixture.options,
      entryFiles: [...fixture.options.entryFiles, 'modern.config.mjs'],
    },
    {
      ...fixture.options,
      entryFiles: [...fixture.options.entryFiles, 'src/build-leaf.cjs'],
    },
  ])
    assert.throws(
      () => auditInstalledConsumer(options),
      /Unverifiable computed module import.*build-leaf.cjs/u,
    );
});

test('literal host loads with an unproved require anchor stay unverified and fail after runtime promotion', t => {
  const fixture = hostBuildConsumerFixture(t, { unprovenAnchor: true });
  const report = auditInstalledConsumer(fixture.options);
  assert(
    report.unverifiedBuildLoads.some(
      item =>
        item.source === 'src/build-leaf.cjs' &&
        item.kind === 'unverifiable-require-anchor' &&
        item.specifier === './host-input.json',
    ),
  );
  assert(
    !report.buildEntryClosure.some(item => item.path === 'src/host-input.json'),
  );
  assert(
    !report.entryClosure.some(item => item.path === 'src/host-input.json'),
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        entryFiles: [...fixture.options.entryFiles, 'src/build-leaf.cjs'],
      }),
    /Unverifiable createRequire anchor.*build-leaf.cjs/u,
  );
  write(
    path.join(fixture.root, 'src/entry.tsx'),
    "import tool from './build-tool.cjs';\nvoid tool;\n",
  );
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /Unverifiable createRequire anchor.*build-leaf.cjs/u,
  );
});

test('runtime promotion rescans an already host-scanned shared dependency and all its outgoing edges', t => {
  const fixture = hostBuildConsumerFixture(t);
  write(
    path.join(fixture.root, 'src/runtime-bridge.mjs'),
    "import tool from './build-tool.cjs';\nexport default tool;\n",
  );
  write(
    path.join(fixture.root, 'src/entry.tsx'),
    "import tool from './runtime-bridge.mjs';\nvoid tool;\n",
  );
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /Unverifiable computed module import.*build-leaf.cjs/u,
  );
});

test('a promoted static shared closure is reported solely as runtime', t => {
  const fixture = hostBuildConsumerFixture(t, { computed: false });
  write(
    path.join(fixture.root, 'src/entry.tsx'),
    "import tool from './build-tool.cjs';\nvoid tool;\n",
  );
  const report = auditInstalledConsumer(fixture.options);
  assert.deepEqual(report.unverifiedBuildLoads, []);
  assert.deepEqual(
    report.buildEntryClosure.map(item => item.path),
    ['modern.config.mjs'],
  );
  for (const file of [
    'src/build-tool.cjs',
    'src/build-leaf.cjs',
    'src/host-input.json',
  ])
    assert(
      report.entryClosure.some(item => item.path === file),
      file,
    );
});

test('host role retains unresolved static ESM import and physical dependency identity failures', t => {
  const fixture = hostBuildConsumerFixture(t);
  const leaf = path.join(fixture.root, 'src/build-leaf.cjs');
  write(leaf, "module.exports = require('./missing-static-tool.mjs');\n");
  write(
    path.join(fixture.root, 'src/missing-static-tool.mjs'),
    "import 'missing-build-tool';\n",
  );
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /Unresolved installed entry import missing-build-tool/u,
  );
  installFixture(fixture.root, 'foreign-build-tool', {
    name: 'different-owner',
  });
  const manifestPath = path.join(fixture.root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.dependencies['foreign-build-tool'] = version;
  writeJson(manifestPath, manifest);
  write(leaf, "module.exports = require('foreign-build-tool');\n");
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /Installed identity mismatch for foreign-build-tool/u,
  );
});

test('unresolved literal host require requests are disclosed but fail for runtime roots and promotion', t => {
  const fixture = hostBuildConsumerFixture(t, { unresolvedRequire: true });
  const report = auditInstalledConsumer(fixture.options);
  assert.deepEqual(report.unverifiedBuildLoads, [
    {
      source: 'src/build-leaf.cjs',
      sourceSha256: fileSha256(path.join(fixture.root, 'src/build-leaf.cjs')),
      line: 1,
      specifier: 'missing-host-adapter',
      kind: 'unresolved-require',
      admission: 'unverified-host-build-load',
    },
  ]);
  assert(
    !report.entryClosure.some(item =>
      item.path.includes('missing-host-adapter'),
    ),
  );
  assert(
    !report.buildEntryClosure.some(item =>
      item.path.includes('missing-host-adapter'),
    ),
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        entryFiles: [...fixture.options.entryFiles, 'src/build-leaf.cjs'],
      }),
    /Unresolved installed entry import missing-host-adapter/u,
  );
  write(
    path.join(fixture.root, 'src/entry.tsx'),
    "import tool from './build-tool.cjs';\nvoid tool;\n",
  );
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /Unresolved installed entry import missing-host-adapter/u,
  );
  write(
    path.join(fixture.root, 'src/entry.tsx'),
    'export const runtime = true;\n',
  );
  installFixture(fixture.root, 'incomplete-build-tool', {
    exports: { '.': './missing.js' },
  });
  write(
    path.join(fixture.root, 'src/build-leaf.cjs'),
    "module.exports = require('incomplete-build-tool');\n",
  );
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /Unresolved entry import incomplete-build-tool/u,
  );
});

test('host admission requires successful command and unchanged completed build evidence', t => {
  const fixture = hostBuildConsumerFixture(t);
  for (const options of [
    { ...fixture.options, buildCommandEvidence: undefined },
    {
      ...fixture.options,
      buildCommandEvidence: {
        ...fixture.options.buildCommandEvidence,
        exitCode: 1,
      },
    },
    { ...fixture.options, rendererBuildEvidence: undefined },
    {
      ...fixture.options,
      rendererBuildEvidence: {
        ...fixture.options.rendererBuildEvidence,
        sha256: '0'.repeat(64),
      },
    },
  ])
    assert.throws(
      () => auditInstalledConsumer(options),
      /successful completed build command|observed completed-build evidence/u,
    );
});

test('host entry authority rejects changed pre-build bytes and installed-package relabeling', t => {
  const fixture = hostBuildConsumerFixture(t);
  const file = path.join(
    fixture.root,
    'node_modules',
    rendererPackage,
    'index.js',
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        buildEntryFiles: [
          {
            path: path.relative(fixture.root, file),
            purpose: 'configuration',
            sha256: fileSha256(file),
            byteLength: fs.statSync(file).size,
          },
        ],
      }),
    /application-owned configuration or metadata file/u,
  );
  fs.appendFileSync(fixture.config, '// changed after the build\n');
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /differs from the observed pre-build input/u,
  );
});

function anchoredConsumerFixture(
  t,
  format = 'esm',
  mutation,
  selfExport = false,
) {
  const root = ownedDirectory(t);
  const staged = path.join(root, 'staged');
  const entry = `dist/entry.${format === 'esm' ? 'mjs' : 'cjs'}`;
  const pathObject = format === 'esm' ? 'nodePath' : 'pathDefault()';
  const fsObject = format === 'esm' ? 'nodeFs' : 'fsDefault()';
  const factory =
    format === 'esm' ? 'createRequire' : '(0, nodeModule.createRequire)';
  const requireName = format === 'esm' ? 'require' : 'require1';
  const directory = format === 'esm' ? '__moduleDirectory' : '__dirname';
  let header =
    format === 'esm'
      ? `import nodeFs from 'node:fs';\nimport nodePath from 'node:path';\nimport { createRequire } from 'node:module';\nimport { fileURLToPath as moduleFilename } from 'node:url';\nimport { dirname as moduleDirectory } from 'node:path';\nvar __moduleDirectory = moduleDirectory(moduleFilename(import.meta.url));\n`
      : `var __webpack_require__ = {};\n__webpack_require__.n = value => () => value;\nconst fsNamespace = require('node:fs');\nvar fsDefault = __webpack_require__.n(fsNamespace);\nconst pathNamespace = require('node:path');\nvar pathDefault = __webpack_require__.n(pathNamespace);\nconst nodeModule = require('node:module');\n`;
  if (format === 'cjs-interop')
    header = header.replace(
      '__webpack_require__.n = value => () => value;',
      `
__webpack_require__.n = module => {
  var getter = module && module.__esModule ? () => module['default'] : () => module;
  __webpack_require__.d(getter, { a: getter });
  return getter;
};
__webpack_require__.d = (exports, getters, values) => {
  var define = (defs, kind) => {
    for (var key in defs) if (__webpack_require__.o(defs, key) && !__webpack_require__.o(exports, key)) Object.defineProperty(exports, key, { enumerable: true, [kind]: defs[key] });
  };
  define(getters, 'get');
  define(values, 'value');
};
__webpack_require__.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
`,
    );
  let source = `${header}
function locatePrivateDirectory() {
  let directory = ${directory};
  while (true) {
    ${format === 'esm' ? `const manifest = ${pathObject}.join(directory, 'package.json');` : ''}
    const privateDirectory = ${pathObject}.join(directory, 'src/private');
    if (${fsObject}.existsSync(${format === 'esm' ? 'manifest' : `${pathObject}.join(directory, 'package.json')`}) && ${fsObject}.existsSync(${pathObject}.join(privateDirectory, 'sentinel.cjs'))) return privateDirectory;
    const parent = ${pathObject}.dirname(directory);
    if (parent === directory) throw new Error('Missing package root');
    directory = parent;
  }
}
function readNative() {
  const directory = locatePrivateDirectory();
  const ${requireName} = ${factory}(${pathObject}.join(directory, 'index.cjs'));
  return ${requireName}('./helper.cjs');
}
console.log(readNative().native);
`;
  if (selfExport) {
    const filename = 'dist/esm-node/renderers/react/registration.mjs';
    const actual = fs.readFileSync(
      path.join(compilerActivationOwner, filename),
      'utf8',
    );
    const ast = parseSync(actual, {
      filename,
      babelrc: false,
      configFile: false,
    });
    const imports = ast.program.body.filter(
      item =>
        item.type === 'ImportDeclaration' &&
        item.source.value.startsWith('node:'),
    );
    const compose = ast.program.body.find(
      item => item.type === 'FunctionDeclaration' && item.id.name === 'compose',
    );
    assert(compose);
    source = `${imports.map(item => actual.slice(item.start, item.end)).join('\n')}\n${actual.slice(compose.start, compose.end)}\ncreateRequire(import.meta.url).resolve('node:path');\nconsole.log(compose([]).native);\n`;
  }
  if (mutation === 'early-return')
    source = source.replace(
      'while (true) {',
      'return directory;\n  while (true) {',
    );
  if (mutation === 'side-effect')
    source = source.replace(
      'while (true) {',
      'while (true) {\n    globalThis.anchorSideEffect = true;',
    );
  if (mutation === 'computed-path')
    source = source.replace("'src/private'", "['src', 'private'].join('/')");
  if (mutation === 'guard') source = source.replace(') && ', ') || ');
  if (mutation === 'cursor')
    source = source.replace(
      'directory = parent;',
      'directory = privateDirectory;',
    );
  if (mutation === 'unknown-anchor')
    source = source.replace(
      `${pathObject}.join(directory, 'index.cjs')`,
      'process.env.UNKNOWN_ANCHOR',
    );
  if (mutation === 'mutable-require')
    source = source
      .replace(`const ${requireName} =`, `let ${requireName} =`)
      .replace(
        `return ${requireName}`,
        `${requireName} = () => ({ native: false });\n  return ${requireName}`,
      );
  if (mutation === 'shadow-factory')
    source =
      format === 'esm'
        ? source.replace(
            "import { createRequire } from 'node:module';",
            'function createRequire() { return () => ({ native: false }); }',
          )
        : source.replace(
            "const nodeModule = require('node:module');",
            'const nodeModule = { createRequire() { return () => ({ native: false }); } };',
          );
  if (mutation === 'path-write')
    source = source.replace(
      'function locatePrivateDirectory()',
      `${pathObject}.join = () => '/foreign';\nfunction locatePrivateDirectory()`,
    );
  if (mutation === 'module-write')
    source = source.replace(
      'function locatePrivateDirectory()',
      'nodeModule.createRequire = () => () => true;\nfunction locatePrivateDirectory()',
    );
  if (mutation === 'module-escape')
    source = source.replace(
      'function locatePrivateDirectory()',
      '((value) => { value.join = () => "/foreign"; })(nodePath);\nfunction locatePrivateDirectory()',
    );
  if (mutation === 'secondary-alias-write')
    source = source.replace(
      'function locatePrivateDirectory()',
      "const otherPath = require('node:path');\notherPath.join = () => '/foreign';\nfunction locatePrivateDirectory()",
    );
  if (mutation === 'dirname-write')
    source = source.replace(
      'function locatePrivateDirectory()',
      "__dirname = '/foreign';\nfunction locatePrivateDirectory()",
    );
  if (mutation === 'interop-substitution')
    source = source.replace(
      '__webpack_require__.n = value => () => value;',
      '__webpack_require__.n = value => () => ({ join: () => "/foreign", existsSync: () => true });',
    );
  if (mutation === 'interop-rewrite')
    source = source.replace(
      'function locatePrivateDirectory()',
      '__webpack_require__.n = value => () => value;\nfunction locatePrivateDirectory()',
    );
  if (mutation === 'object-alias-write')
    source = source.replace(
      'function locatePrivateDirectory()',
      'const objectAlias = Object;\nobjectAlias.defineProperty = () => true;\nfunction locatePrivateDirectory()',
    );
  if (mutation === 'object-prototype-write')
    source = source.replace(
      'function locatePrivateDirectory()',
      'const prototypeAlias = Object.prototype;\nprototypeAlias.hasOwnProperty = () => true;\nfunction locatePrivateDirectory()',
    );
  if (mutation === 'object-escape')
    source = source.replace(
      'function locatePrivateDirectory()',
      '((value) => { value.defineProperty = () => true; })(Object);\nfunction locatePrivateDirectory()',
    );
  if (mutation === 'interop-expression-substitution')
    source = source.replace(
      '__webpack_require__.d(getter, { a: getter });',
      'getter = () => ({ join: () => "/foreign" });',
    );
  writeJson(path.join(staged, 'package.json'), {
    name: rendererPackage,
    version,
    publishConfig: { access: 'public' },
    type: format === 'esm' ? 'module' : 'commonjs',
    engines: { node: '>=26.10.0' },
    exports: {
      '.': {
        types: './index.d.ts',
        import: `./${entry}`,
        require: `./${entry}`,
      },
      ...(selfExport && mutation !== 'missing-self-export'
        ? {
            './react-composition': {
              node: {
                [mutation === 'wrong-self-condition' ? 'import' : 'require']:
                  './src/private/helper.cjs',
              },
            },
          }
        : {}),
    },
  });
  write(path.join(staged, entry), source);
  write(
    path.join(staged, 'index.d.ts'),
    'export declare const native: boolean;\n',
  );
  write(
    path.join(staged, 'src/private/helper.cjs'),
    mutation === 'forbidden-helper'
      ? "require('react');\nmodule.exports = { native: true };\n"
      : mutation === 'missing-helper-dependency'
        ? "require('undeclared-helper-runtime');\nmodule.exports = { native: true };\n"
        : selfExport
          ? 'exports.composeReactRenderer = () => require("./deep.cjs");\n'
          : 'module.exports = { native: true };\n',
  );
  if (selfExport)
    write(
      path.join(staged, 'src/private/deep.cjs'),
      mutation === 'forbidden-self-dependency'
        ? "require('react');\nmodule.exports = { native: true };\n"
        : mutation === 'missing-self-dependency'
          ? "require('undeclared-self-runtime');\nmodule.exports = { native: true };\n"
          : 'module.exports = { native: true };\n',
    );
  if (mutation !== 'missing-sentinel')
    write(
      path.join(staged, 'src/private/sentinel.cjs'),
      'module.exports = {};\n',
    );
  if (mutation === 'foreign-root') {
    writeJson(path.join(staged, 'dist/package.json'), {
      name: 'foreign-root',
      version,
      type: format === 'esm' ? 'module' : 'commonjs',
    });
    write(
      path.join(staged, 'dist/src/private/sentinel.cjs'),
      'module.exports = {};\n',
    );
  }
  const generatorName = '@bleedingdev/modern-js-ultramodern-create';
  const utilityName = '@bleedingdev/modern-js-i18n-utils';
  const stagedUtility = path.join(root, 'staged-utility');
  writeJson(path.join(stagedUtility, 'package.json'), {
    name: utilityName,
    version,
    publishConfig: { access: 'public' },
    engines: { node: '>=26.10.0' },
    exports: { '.': { types: './index.d.ts', import: './index.js' } },
  });
  write(path.join(stagedUtility, 'index.js'), 'export const fixture = true;\n');
  write(
    path.join(stagedUtility, 'index.d.ts'),
    'export declare const fixture: true;\n',
  );
  const stagedGenerator = path.join(root, 'staged-generator');
  writeJson(path.join(stagedGenerator, 'package.json'), {
    name: generatorName,
    version,
    publishConfig: { access: 'public' },
    engines: { node: '>=26.10.0' },
    exports: {
      '.': './index.js',
      './ultramodern-workspace': './index.js',
      './ultramodern-workspace/codesmith': './index.js',
    },
    ultramodern: { frameworkVersion: version },
    dependencies: { '@modern-js/i18n-utils': `npm:${utilityName}@${version}` },
  });
  write(
    path.join(stagedGenerator, 'index.js'),
    'export const fixture = true;\n',
  );
  for (const file of createTemplateRequiredFiles)
    write(path.join(stagedGenerator, file), 'fixture\n');
  createReleaseArtifacts({
    aliases: {
      '@modern-js/renderer-solid': rendererPackage,
      '@modern-js/ultramodern-create': generatorName,
      '@modern-js/i18n-utils': utilityName,
    },
    command: execFileSync,
    packages: [
      {
        packageDir: path.relative(repoRoot, staged),
        sourceName: '@modern-js/renderer-solid',
        targetName: rendererPackage,
        version,
      },
      {
        packageDir: path.relative(repoRoot, stagedGenerator),
        sourceName: '@modern-js/ultramodern-create',
        targetName: generatorName,
        version,
      },
      {
        packageDir: path.relative(repoRoot, stagedUtility),
        sourceName: '@modern-js/i18n-utils',
        targetName: utilityName,
        version,
      },
    ],
    source: {
      commit: sourceRevision,
      repository: 'BleedingDev/ultramodern.js',
    },
    tag: 'preview',
    tools: { node: process.version, npm: 'fixture-npm', pnpm: 'fixture-pnpm' },
    version,
    outDir: path.join(root, 'release'),
  });
  const releaseArtifacts = auditReleaseArtifacts({
    manifestPath: path.join(root, 'release/manifest.json'),
    expectedSourceRevision: sourceRevision,
  });
  const consumer = path.join(root, 'consumer');
  writeJson(path.join(consumer, 'package.json'), {
    name: 'anchor-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@modern-js/renderer-solid': `npm:${rendererPackage}@${version}`,
    },
  });
  const installed = path.join(consumer, 'node_modules', rendererPackage);
  const artifact = releaseArtifacts.artifacts.find(
    item => item.sourceName === '@modern-js/renderer-solid',
  );
  const inspection = inspectNpmTarball(fs.readFileSync(artifact.path));
  for (const [file, bytes] of inspection.fileContents)
    write(path.join(installed, file), bytes);
  fs.mkdirSync(path.join(consumer, 'node_modules/@modern-js'), {
    recursive: true,
  });
  fs.symlinkSync(
    '../@bleedingdev/modern-js-renderer-solid',
    path.join(consumer, 'node_modules/@modern-js/renderer-solid'),
  );
  write(
    path.join(consumer, 'src/entry.mjs'),
    "import '@modern-js/renderer-solid';\n",
  );
  return {
    root: consumer,
    installed,
    entry: path.join(installed, entry),
    artifact,
    options: {
      consumerRoot: consumer,
      renderer: 'solid',
      exactPackages: { [rendererPackage]: version },
      entryFiles: ['src/entry.mjs'],
      releaseArtifacts,
    },
  };
}

function octaneConsumerFixture(t) {
  const root = ownedDirectory(t);
  writeJson(path.join(root, 'package.json'), {
    name: 'octane-consumer',
    private: true,
    type: 'module',
    dependencies: { octane: octaneVersion },
    devDependencies: {},
  });
  const octane = installFixture(root, 'octane', {
    version: octaneVersion,
    dependencies: { '@types/react': '^19.2.17', csstype: '^3.2.3' },
    peerDependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    peerDependenciesMeta: {
      react: { optional: true },
      'react-dom': { optional: true },
    },
    exports: {
      '.': { types: './dist/index.d.ts', import: './index.js' },
    },
  });
  for (const [file, bytes] of frozenTypeInteropDeclarations())
    if (file.startsWith('octane/'))
      write(path.join(octane, file.slice('octane/'.length)), bytes);
  const declarations = installFixture(root, '@types/react', {
    version: reactTypesVersion,
    types: './index.d.ts',
    exports: './index.d.ts',
    dependencies: { csstype: '^3.2.3' },
  });
  for (const file of typeInteropEvidence.reactFiles) {
    const relative = file.packagePath.slice('@types/react/'.length);
    const bytes = frozenTypeInteropDeclarations().get(file.packagePath);
    assert.equal(bytes.length, file.size);
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      file.sha256,
    );
    write(path.join(declarations, relative), bytes);
  }
  installFixture(root, 'csstype', {
    version: '3.2.3',
    types: './index.d.ts',
    exports: './index.d.ts',
  });
  installFixture(root, 'alien-signals', {
    version: '3.1.2',
    exports: {
      '.': { types: './index.d.ts' },
      './system': { types: './index.d.ts' },
    },
  });
  write(path.join(root, 'src', 'entry.ts'), "import 'octane';\n");
  write(path.join(root, 'dist', 'server.mjs'), "import 'octane';\n");
  return {
    root,
    octane,
    declarations,
    options: {
      consumerRoot: root,
      renderer: 'octane',
      exactPackages: {
        octane: octaneVersion,
        '@types/react': reactTypesVersion,
      },
      entryFiles: ['src/entry.ts', 'dist/server.mjs'],
    },
  };
}

test('Octane records exact native-authored JSX type interop without installing React', t => {
  const { options } = octaneConsumerFixture(t);
  const report = auditInstalledConsumer(options);
  assert.equal(report.permittedTypeDependencies.length, 1);
  assert.equal(report.permittedTypeDependencies[0].name, '@types/react');
  assert.equal(report.permittedTypeDependencies[0].version, reactTypesVersion);
  assert.equal(report.permittedTypeImports.length, 2);
  assert.equal(report.permittedTypeImports[0].owner, 'octane');
  assert.match(report.permittedTypeImports[0].sourceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    report.permittedTypeDependencies[0].reason,
    'octane-native-authored-jsx-type-interop',
  );
  assert.equal(
    report.nativeTypeInterop.evidenceSha256,
    fileSha256(typeInteropEvidencePath),
  );
  assert.equal(report.nativeTypeInterop.providerVersion, octaneVersion);
  assert.equal(report.nativeTypeInterop.incomingEdges.length, 4);
  assert.equal(report.nativeTypeInterop.files.length, 5);
  assert.deepEqual(
    report.nativeTypeInterop.files
      .filter(file => file.owner === '@types/react')
      .map(file => file.packagePath),
    typeInteropEvidence.declaredScope.exactPermittedFiles.slice().sort(),
  );
  assert.equal(
    report.closure.some(item => item.name === 'react'),
    false,
  );
  assert.deepEqual(
    report.missingOptional.map(item => [item.name, item.reason]),
    [
      ['react', 'octane-compatibility-export-peer-absent'],
      ['react-dom', 'octane-compatibility-export-peer-absent'],
    ],
  );
  assert.ok(
    report.entryClosure.some(item =>
      item.path.endsWith('@types/react/index.d.ts'),
    ),
  );
  assert.throws(
    () => auditInstalledConsumer({ ...options, renderer: 'solid' }),
    /forbidden React\/RSC/u,
  );
});

test('Octane declaration permission does not admit app React types, runtime, compatibility entries or router augmentation', t => {
  for (const source of [
    "import type * as React from 'react';\n",
    "export type Element = import('react').JSX.Element;\n",
    '/** @jsxImportSource react */\nexport const native = true;\n',
    "import 'react';\n",
    "import 'octane/react';\n",
    "import 'octane/react/server';\n",
    "declare module '@tanstack/react-router' { interface Register {} }\n",
    "declare module '@tanstack/solid-router' { interface Register {} }\n",
  ]) {
    const { options, root } = octaneConsumerFixture(t);
    write(path.join(root, 'src', 'entry.ts'), source);
    assert.throws(
      () => auditInstalledConsumer(options),
      /authenticated bytes|React\/RSC/u,
    );
  }
});

test('Octane declaration permission verifies the installed owner and rejects runtime exports', t => {
  for (const source of [
    "import * as React from 'react';\n",
    '/** @jsxImportSource react */\nexport type Widget = {};\n',
  ]) {
    const { options, octane } = octaneConsumerFixture(t);
    write(path.join(octane, 'dist', 'public-types.d.ts'), source);
    assert.throws(
      () => auditInstalledConsumer(options),
      /authenticated bytes|React\/RSC/u,
    );
  }
  const { options, declarations } = octaneConsumerFixture(t);
  writeJson(path.join(declarations, 'package.json'), {
    name: '@types/react',
    version: reactTypesVersion,
    main: './index.js',
    types: './index.d.ts',
  });
  assert.throws(
    () => auditInstalledConsumer(options),
    /declarations only.*runtime entry/u,
  );
});

test('Octane type permission requires its selected owned declaration and checks undeclared owner-local React runtime', t => {
  const first = octaneConsumerFixture(t);
  write(
    path.join(first.octane, 'dist', 'neutral.d.ts'),
    'export type Widget = {};\n',
  );
  const firstManifest = path.join(first.octane, 'package.json');
  const firstPackage = JSON.parse(fs.readFileSync(firstManifest, 'utf8'));
  firstPackage.exports['.'].types = './dist/neutral.d.ts';
  writeJson(firstManifest, firstPackage);
  assert.throws(
    () => auditInstalledConsumer(first.options),
    /permission requires a selected type-only import/u,
  );
  const second = octaneConsumerFixture(t);
  const manifestPath = path.join(second.octane, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  delete manifest.peerDependencies['react-dom'];
  writeJson(manifestPath, manifest);
  installFixture(second.octane, 'react-dom');
  assert.throws(
    () => auditInstalledConsumer(second.options),
    /octane@.* resolves a forbidden React\/RSC runtime package react-dom/u,
  );
});

test('Octane type interop rejects every frozen declaration byte or owner identity drift', t => {
  for (const file of [
    ...typeInteropEvidence.nativeFiles,
    ...typeInteropEvidence.reactFiles,
  ]) {
    const fixture = octaneConsumerFixture(t);
    const directory = file.packagePath.startsWith('octane/')
      ? fixture.octane
      : fixture.declarations;
    const relative = file.packagePath.replace(
      /^(?:octane|@types\/react)\//u,
      '',
    );
    fs.appendFileSync(path.join(directory, relative), '\n// drift\n');
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /authenticated bytes/u,
      file.packagePath,
    );
  }
  for (const providerVersion of ['0.7.1', '0.7.1+ultramodern.other']) {
    const { root, octane, options } = octaneConsumerFixture(t);
    const ownerPath = path.join(octane, 'package.json');
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    owner.version = providerVersion;
    writeJson(ownerPath, owner);
    const appPath = path.join(root, 'package.json');
    const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
    app.dependencies.octane = providerVersion;
    writeJson(appPath, app);
    options.exactPackages.octane = providerVersion;
    assert.throws(
      () => auditInstalledConsumer(options),
      /forbidden React\/RSC/u,
    );
  }
  const { declarations, options } = octaneConsumerFixture(t);
  const declarationPath = path.join(declarations, 'package.json');
  const declaration = JSON.parse(fs.readFileSync(declarationPath, 'utf8'));
  declaration.version = '19.2.17';
  writeJson(declarationPath, declaration);
  options.exactPackages['@types/react'] = '19.2.17';
  assert.throws(
    () => auditInstalledConsumer(options),
    /exact authenticated @types\/react identity/u,
  );
});

test('Octane type interop cannot be borrowed by root, app-relative, direct or extra declaration entries', t => {
  for (const injection of [
    'root-development',
    'app-index',
    'app-global',
    'direct-index',
    'extra-entry',
    'extra-native',
  ]) {
    const { root, octane, declarations, options } = octaneConsumerFixture(t);
    if (injection === 'root-development') {
      const file = path.join(root, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      manifest.devDependencies['@types/react'] = reactTypesVersion;
      writeJson(file, manifest);
    } else if (injection === 'app-index' || injection === 'app-global') {
      write(
        path.join(root, 'src', 'entry.ts'),
        `export type * from '../node_modules/@types/react/${injection === 'app-index' ? 'index' : 'global'}.d.ts';\n`,
      );
    } else if (injection === 'direct-index')
      options.entryFiles.push('node_modules/@types/react/index.d.ts');
    else if (injection === 'extra-entry') {
      write(
        path.join(declarations, 'extra.d.ts'),
        'export declare const extra: boolean;\n',
      );
      options.entryFiles.push('node_modules/@types/react/extra.d.ts');
    } else {
      write(
        path.join(octane, 'dist', 'extra.d.ts'),
        "import type * as React from 'react';\nexport type Extra = React.ReactNode;\n",
      );
      options.entryFiles.push('node_modules/octane/dist/extra.d.ts');
    }
    assert.throws(
      () => auditInstalledConsumer(options),
      /forbidden React\/RSC|Forbidden .*Octane React declaration/u,
      injection,
    );
  }
});

test('Octane type interop authenticates the evidence file before allowing declaration bytes', t => {
  const { options } = octaneConsumerFixture(t);
  const read = fs.readFileSync;
  const mocked = t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const bytes = read.call(this, file, ...args);
    return file === typeInteropEvidencePath
      ? Buffer.concat([Buffer.from(bytes), Buffer.from('\n')])
      : bytes;
  });
  assert.throws(
    () => auditInstalledConsumer(options),
    /authenticated source freeze/u,
  );
  mocked.mock.restore();
});

test('Octane React type imports cannot redirect the frozen edge through mutable package metadata', t => {
  for (const injection of [
    'escaped-export',
    'extra-export',
    'renamed-package',
  ]) {
    const { root, octane, declarations, options } = octaneConsumerFixture(t);
    const file = path.join(declarations, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (injection === 'renamed-package') {
      const ownerFile = path.join(octane, 'package.json');
      const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
      owner.dependencies['@types/react'] =
        `npm:neutral-declarations@${reactTypesVersion}`;
      writeJson(ownerFile, owner);
      delete options.exactPackages['@types/react'];
      manifest.name = 'neutral-declarations';
    } else {
      manifest.exports =
        injection === 'escaped-export'
          ? '../../../neutral.d.ts'
          : './extra.d.ts';
      write(
        injection === 'escaped-export'
          ? path.join(root, 'neutral.d.ts')
          : path.join(declarations, 'extra.d.ts'),
        'export declare const neutral: boolean;\n',
      );
    }
    writeJson(file, manifest);
    assert.throws(
      () => auditInstalledConsumer(options),
      /authenticated .*identity|authenticated index\.d\.ts/u,
      injection,
    );
  }
});

test('native audit rejects physically installed undeclared React and parses TypeScript import types', t => {
  const { options, root } = consumerFixture(t);
  write(
    path.join(root, 'src', 'entry.tsx'),
    "export type Native = typeof import('solid-js').native;\n",
  );
  assert.ok(
    auditInstalledConsumer(options).entryClosure.some(item =>
      item.path.endsWith('solid-js/index.d.ts'),
    ),
  );
  installFixture(root, 'react');
  assert.throws(
    () => auditInstalledConsumer(options),
    /resolves a forbidden React\/RSC runtime/u,
  );
});

test('native compiler provenance binds actual raw source, client build and emitted JavaScript bytes', t => {
  const { root, options } = octaneConsumerFixture(t);
  const packageName = '@bleedingdev/modern-js-renderer-octane';
  const directory = installFixture(root, packageName, {
    exports: { '.': './index.js', './manifest': './manifest.cjs' },
  });
  // This fixture exercises the auditor's installed API handshake and byte
  // checks. The owning renderer package tests its full public ABI validator.
  write(
    path.join(directory, 'manifest.cjs'),
    `exports.validateOctaneModuleManifest = (value, identity, buildId) => {
      if (JSON.stringify(value.rendererIdentity) !== JSON.stringify(identity)) throw new Error('Fixture renderer identity mismatch');
      if (value.nativeHydrationBuildId !== buildId) throw new Error('Fixture native build mismatch');
      if (value.runtimeVersion !== '${octaneVersion}' || value.compilerVersion !== '0.1.55') throw new Error('Fixture compiler tuple mismatch');
      return value;
    };\n`,
  );
  const compiler = '@octanejs/rspack-plugin';
  installFixture(root, compiler, { version: '0.1.55' });
  const packageFile = path.join(root, 'package.json');
  const application = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  application.dependencies[packageName] = version;
  application.devDependencies[compiler] = '0.1.55';
  writeJson(packageFile, application);
  const nativeSource = path.join(root, 'src', 'native.tsrx');
  write(nativeSource, 'export const Native = @{ <div>Native</div> };\n');
  const asset = path.join(root, 'dist', 'client.js');
  write(asset, 'globalThis.nativeCompiled = true;\n');
  const rendererIdentity = {
    renderer: 'octane',
    appId: 'native-test',
    entryName: 'main',
    protocolVersion: 1,
    buildId: 'c'.repeat(64),
  };
  const clientBuildFile = path.join(root, 'dist', 'octane-client-build.json');
  writeJson(clientBuildFile, { version: 1, buildId: 'f'.repeat(20) });
  const manifestFile = path.join(
    root,
    'dist',
    'octane-module-manifest.main.json',
  );
  const manifest = {
    schemaVersion: 1,
    renderer: 'octane',
    runtimeVersion: octaneVersion,
    compilerVersion: '0.1.55',
    rendererIdentity,
    nativeHydrationBuildId: 'f'.repeat(20),
    sourceModules: [
      {
        resource: 'src/native.tsrx?native-widget',
        canonicalId: 'native-test:src/native.tsrx',
        moduleId: 1,
        transformKind: 'compile',
        sourceSha256: fileSha256(nativeSource),
        emittedSourceSha256: 'a'.repeat(64),
        assets: ['client.js'],
      },
    ],
    assets: [{ file: 'client.js', sha256: fileSha256(asset) }],
  };
  writeJson(manifestFile, manifest);
  const compilerOptions = {
    ...options,
    exactPackages: {
      ...options.exactPackages,
      [packageName]: version,
      [compiler]: '0.1.55',
    },
    entryFiles: [...options.entryFiles, 'src/native.tsrx'],
    nativeCompilerManifests: [
      {
        manifestPath: 'dist/octane-module-manifest.main.json',
        rendererIdentity,
      },
    ],
  };
  const report = auditInstalledConsumer(compilerOptions);
  assert.equal(report.nativeCompilerProofs.length, 1);
  assert.equal(report.nativeCompilerProofs[0].validator.name, packageName);
  assert.equal(
    report.nativeCompilerProofs[0].validator.installationName,
    packageName,
  );
  assert.equal(
    report.nativeCompilerProofs[0].sourceModules[0].path,
    'src/native.tsrx',
  );
  assert.equal(
    report.nativeCompilerProofs[0].nativeHydrationBuildId,
    'f'.repeat(20),
  );
  assert.equal(
    report.nativeCompilerProofs[0].clientBuildMetadataSha256,
    fileSha256(clientBuildFile),
  );
  assert.ok(report.entryClosure.some(item => item.path === 'dist/client.js'));
  const storedRenderer = path.join(
    root,
    'node_modules',
    '.fixture-store',
    'renderer-octane',
  );
  fs.mkdirSync(path.dirname(storedRenderer), { recursive: true });
  fs.renameSync(directory, storedRenderer);
  const aliasName = '@modern-js/renderer-octane';
  const aliasPath = path.join(root, 'node_modules', aliasName);
  fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
  fs.symlinkSync(
    path.relative(path.dirname(aliasPath), storedRenderer),
    aliasPath,
  );
  delete application.dependencies[packageName];
  application.dependencies[aliasName] = `npm:${packageName}@${version}`;
  writeJson(packageFile, application);
  assert.equal(
    auditInstalledConsumer(compilerOptions).nativeCompilerProofs[0].validator
      .installationName,
    aliasName,
  );
  const applicationRoot = 'apps/native';
  writeJson(path.join(root, applicationRoot, 'package.json'), application);
  write(
    path.join(root, applicationRoot, 'src', 'entry.ts'),
    "import 'octane';\n",
  );
  compilerOptions.applicationRoot = applicationRoot;
  compilerOptions.entryFiles = [
    `${applicationRoot}/src/entry.ts`,
    'dist/server.mjs',
    'src/native.tsrx',
  ];
  manifest.sourceModules[0].resource = '../../src/native.tsrx?native-widget';
  manifest.sourceModules.push({
    ...manifest.sourceModules[0],
    resource: '../../src/native.tsrx?native-client-stub',
    moduleId: 2,
    transformKind: 'client-only-stub',
    emittedSourceSha256: 'b'.repeat(64),
  });
  writeJson(manifestFile, manifest);
  const leafReport = auditInstalledConsumer(compilerOptions);
  assert.equal(leafReport.nativeCompilerProofs[0].sourceModules.length, 2);
  assert.ok(
    leafReport.nativeCompilerProofs[0].sourceModules.every(
      source => source.path === 'src/native.tsrx',
    ),
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...compilerOptions,
        nativeCompilerManifests: [],
      }),
    /nonempty Octane manifest set/u,
  );
  write(nativeSource, 'export const changed = @{ <div>Changed</div> };\n');
  assert.throws(
    () => auditInstalledConsumer(compilerOptions),
    /source digest differs/u,
  );
  write(nativeSource, 'export const Native = @{ <div>Native</div> };\n');
  write(asset, 'globalThis.changed = true;\n');
  assert.throws(
    () => auditInstalledConsumer(compilerOptions),
    /emitted asset digest differs/u,
  );
  write(asset, 'globalThis.nativeCompiled = true;\n');
  writeJson(clientBuildFile, { version: 1, buildId: 'e'.repeat(20) });
  assert.throws(
    () => auditInstalledConsumer(compilerOptions),
    /native build mismatch/u,
  );
  writeJson(clientBuildFile, { version: 1, buildId: 'f'.repeat(20) });
  manifest.sourceModules[0].resource = '../outside.tsrx';
  writeJson(manifestFile, manifest);
  assert.throws(
    () => auditInstalledConsumer(compilerOptions),
    /Missing or external Octane source/u,
  );
});

test('installed audit follows real aliases, peer dependencies and source/server entries', t => {
  const { options } = consumerFixture(t);
  const report = auditInstalledConsumer(options);
  assert.deepEqual(
    report.closure.map(item => item.name),
    [rendererPackage, 'solid-js'],
  );
  assert.equal(report.closure[0].engines.node, '>=26.10.0');
  assert.equal(report.closure[0].peerDependencies['solid-js'], nativeVersion);
  assert.equal(report.entryClosure.length, 4);
  assert.match(report.closure[0].manifestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(report.exportConditionExecution, 'required-separate-probe');
});

test('declared builtin-named npm dependencies require their real physical package manifests', t => {
  const { options, root } = consumerFixture(t);
  const names = ['events', 'buffer', 'process'];
  const owner = installFixture(root, rendererPackage, {
    peerDependencies: { 'solid-js': nativeVersion },
    dependencies: Object.fromEntries(names.map(name => [name, '1.0.0'])),
  });
  for (const name of names) installFixture(owner, name, { version: '1.0.0' });
  const report = auditInstalledConsumer(options);
  for (const name of names) {
    const record = report.closure.find(item => item.name === name);
    assert(
      record,
      `Declared ${name} must not disappear behind the Node builtin`,
    );
    assert.equal(record.version, '1.0.0');
    assert.equal(
      record.manifestSha256,
      fileSha256(path.join(root, record.path, 'package.json')),
    );
    const directory = path.join(owner, 'node_modules', name);
    const manifest = fs.readFileSync(path.join(directory, 'package.json'));
    fs.unlinkSync(path.join(directory, 'package.json'));
    assert.throws(
      () => auditInstalledConsumer(options),
      new RegExp(`Missing installed dependencies ${name}`, 'u'),
    );
    write(path.join(directory, 'package.json'), manifest);
    const packageJson = JSON.parse(manifest);
    writeJson(path.join(directory, 'package.json'), {
      ...packageJson,
      name: `wrong-${name}`,
    });
    assert.throws(
      () => auditInstalledConsumer(options),
      new RegExp(`Installed identity mismatch for ${name}`, 'u'),
    );
    writeJson(path.join(directory, 'package.json'), {
      ...packageJson,
      version: '1.0.1',
    });
    assert.throws(
      () => auditInstalledConsumer(options),
      new RegExp(`Installed ${name} version .* differs from 1\\.0\\.0`, 'u'),
    );
    write(path.join(directory, 'package.json'), manifest);
  }
  assert.equal(
    auditInstalledConsumer(options).closure.length,
    report.closure.length,
  );
});

test('native audit records absent guarded optional peers without admitting installed React packages', t => {
  const { options, root } = consumerFixture(t);
  const optionalPeers = [
    'react',
    '@rsbuild/plugin-react',
    'react-helmet-async',
  ];
  const owner = installFixture(root, rendererPackage, {
    peerDependencies: {
      'solid-js': nativeVersion,
      ...Object.fromEntries(optionalPeers.map(name => [name, version])),
    },
    peerDependenciesMeta: Object.fromEntries(
      optionalPeers.map(name => [name, { optional: true }]),
    ),
  });
  const report = auditInstalledConsumer(options);
  assert.deepEqual(
    report.missingOptional.map(item => item.name).sort(),
    [...optionalPeers].sort(),
  );
  assert.ok(
    report.missingOptional.every(
      item =>
        item.block === 'peerDependencies' &&
        item.reason === 'optional-peer-absent',
    ),
  );
  assert.equal(
    report.closure.some(item => optionalPeers.includes(item.name)),
    false,
  );
  // Owner-local installation cannot hide behind absence in the app context.
  for (const name of optionalPeers) {
    const installed = installFixture(owner, name);
    assert.throws(
      () => auditInstalledConsumer(options),
      /declares forbidden React\/RSC dependency/u,
    );
    fs.rmSync(installed, { recursive: true });
  }
});

test('native optional peer metadata cannot bypass selected source or declaration imports', t => {
  for (const entry of ['index.js', 'index.d.ts']) {
    const { options, root } = consumerFixture(t);
    const owner = installFixture(root, rendererPackage, {
      peerDependencies: { 'solid-js': nativeVersion, react: version },
      peerDependenciesMeta: { react: { optional: true } },
    });
    write(
      path.join(owner, entry),
      entry.endsWith('.d.ts')
        ? "import type * as React from 'react';\n"
        : "import 'react';\n",
    );
    assert.throws(
      () => auditInstalledConsumer(options),
      /entry imports forbidden React\/RSC module/u,
    );
  }
});

test('native required peers and optionalDependencies stay strict despite optional-peer absence policy', t => {
  for (const block of ['peerDependencies', 'optionalDependencies']) {
    for (const present of [false, true]) {
      const { options, root } = consumerFixture(t);
      const owner = installFixture(root, rendererPackage, {
        peerDependencies: { 'solid-js': nativeVersion },
        [block]: {
          ...(block === 'peerDependencies'
            ? { 'solid-js': nativeVersion }
            : {}),
          react: version,
        },
      });
      if (present) installFixture(owner, 'react');
      assert.throws(
        () => auditInstalledConsumer(options),
        /declares forbidden React\/RSC dependency/u,
      );
    }
  }
});

test('installed audit rejects tuple drift, unknown renderers and missing peers', t => {
  const { options, root } = consumerFixture(t);
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...options,
        exactPackages: { [rendererPackage]: '3.8.3-ultramodern.17' },
      }),
    /Tested tuple.*expected/u,
  );
  assert.throws(
    () => auditInstalledConsumer({ ...options, renderer: undefined }),
    /Unknown renderer/u,
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...options,
        exactPackages: { [rendererPackage]: '^3.8.3' },
      }),
    /exact version/u,
  );
  fs.rmSync(path.join(root, 'node_modules', 'solid-js'), { recursive: true });
  assert.throws(
    () => auditInstalledConsumer(options),
    /Missing installed peerDependencies solid-js/u,
  );
});

test('native audit rejects transitive React, aliased RSC and React compiler packages', t => {
  for (const name of [
    'react',
    '@bleedingdev/modern-js-plugin-rsc',
    '@rsbuild/plugin-react',
  ]) {
    const { options, root } = consumerFixture(t);
    const installedName =
      name === 'react' ? name : 'hidden-renderer-dependency';
    const specifier =
      installedName === name ? version : `npm:${name}@${version}`;
    const file = path.join(
      root,
      'node_modules',
      rendererPackage,
      'package.json',
    );
    writeJson(file, {
      ...JSON.parse(fs.readFileSync(file, 'utf8')),
      dependencies: { [installedName]: specifier },
    });
    installFixture(root, name);
    if (installedName !== name) {
      fs.mkdirSync(
        path.dirname(path.join(root, 'node_modules', installedName)),
        { recursive: true },
      );
      fs.symlinkSync(
        path.join(root, 'node_modules', name),
        path.join(root, 'node_modules', installedName),
      );
    }
    assert.throws(
      () => auditInstalledConsumer(options),
      /forbidden React\/RSC/u,
    );
  }
});

test('native audit detects multiline JSX imports, bundled React and declaration leakage', t => {
  for (const source of [
    "import {\n createElement,\n} from 'react';\n",
    'import{createElement}from"react";\n',
    'export{createElement}from"react";\n',
    'const element = Symbol.for("react.transitional.element");\n',
    '/// <reference types="react" />\n',
    "export { decodeReply } from 'react-server-dom-webpack/server';\n",
  ]) {
    const { options, root } = consumerFixture(t);
    write(path.join(root, 'dist', 'server.mjs'), source);
    assert.throws(() => auditInstalledConsumer(options), /React\/RSC/u);
  }
});

test('native audit rejects ranged prerelease peers and mismatched admission profiles', t => {
  const { options, root } = consumerFixture(t);
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...options,
        testedProfile: { renderer: 'octane', packages: options.exactPackages },
      }),
    /selected renderer/u,
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...options,
        testedProfile: {
          renderer: 'solid',
          packages: { [rendererPackage]: '3.8.3-ultramodern.17' },
        },
      }),
    /differs from the consumer tuple/u,
  );
  const file = path.join(root, 'node_modules', rendererPackage, 'package.json');
  writeJson(file, {
    ...JSON.parse(fs.readFileSync(file, 'utf8')),
    peerDependencies: { 'solid-js': '^2.0.0-rc.13' },
  });
  assert.throws(
    () => auditInstalledConsumer(options),
    /prerelease peer.*must be exact/u,
  );
});

test('native audit checks actual published declaration files', t => {
  const { options, root } = consumerFixture(t);
  fs.rmSync(path.join(root, 'node_modules', rendererPackage, 'index.d.ts'));
  assert.throws(
    () => auditInstalledConsumer(options),
    /Missing selected declaration export/u,
  );
});

test('native compiler and ambient development dependencies cannot hide outside the tuple', t => {
  for (const name of ['@rsbuild/plugin-react', '@types/react']) {
    const { options, root } = consumerFixture(t, {
      devDependencies: { [name]: version },
    });
    installFixture(root, name);
    assert.throws(
      () => auditInstalledConsumer(options),
      /forbidden React\/RSC/u,
    );
  }
});

test('native declaration imports and reference paths receive an independent scan', t => {
  const { options, root } = consumerFixture(t);
  const declaration = path.join(
    root,
    'node_modules',
    rendererPackage,
    'index.d.ts',
  );
  write(
    declaration,
    "/// <reference path='./native.d.ts' />\nexport declare const native: boolean;\n",
  );
  write(
    path.join(path.dirname(declaration), 'native.d.ts'),
    "import type{ReactNode}from'react';\nexport type Native = ReactNode;\n",
  );
  assert.throws(
    () => auditInstalledConsumer(options),
    /forbidden React\/RSC module react/u,
  );
});

test('computed module imports fail closed and comment examples do not become imports', t => {
  const { options, root } = consumerFixture(t);
  const entry = path.join(root, 'dist', 'server.mjs');
  write(
    entry,
    "// import{createElement}from'react'\n/* require('react') */\nexport const native = true;\n",
  );
  assert.equal(auditInstalledConsumer(options).renderer, 'solid');
  for (const source of [
    'const moduleName = "react"; import(moduleName);\n',
    "const suffix='x'; import('./' + suffix);\n",
    "const suffix='x'; require('solid-js' + suffix);\n",
  ]) {
    write(entry, source);
    assert.throws(
      () => auditInstalledConsumer(options),
      /Unverifiable computed/u,
    );
  }
  write(entry, 'const pattern = /["\']/g; export const native = pattern;\n');
  assert.equal(auditInstalledConsumer(options).renderer, 'solid');
  write(entry, 'const text = `$' + '{await import("react")}`;\n');
  assert.throws(() => auditInstalledConsumer(options), /forbidden React\/RSC/u);
});

test('generated workspace leaf resolves its app tuple while native root compiler dependencies remain audited', t => {
  const { options, root } = consumerFixture(t);
  const leaf = path.join(root, 'apps', 'shell-super-app');
  writeJson(
    path.join(leaf, 'package.json'),
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
  );
  writeJson(path.join(root, 'package.json'), {
    name: 'generated-workspace',
    private: true,
  });
  const report = auditInstalledConsumer({
    ...options,
    applicationRoot: 'apps/shell-super-app',
  });
  assert.equal(report.applicationRoot, 'apps/shell-super-app');
  assert.equal(report.closure.length, 2);
  writeJson(path.join(root, 'package.json'), {
    name: 'generated-workspace',
    devDependencies: { '@rsbuild/plugin-react': version },
  });
  installFixture(root, '@rsbuild/plugin-react');
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...options,
        applicationRoot: 'apps/shell-super-app',
      }),
    /forbidden React\/RSC/u,
  );
  assert.throws(
    () => auditInstalledConsumer({ ...options, applicationRoot: '../' }),
    /applicationRoot escapes/u,
  );
});

test('generated catalog aliases bind the actual workspace bytes and installed mapped identity', t => {
  const { options, root } = consumerFixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  manifest.dependencies['@modern-js/renderer-solid'] = 'catalog:ultramodern';
  writeJson(path.join(root, 'package.json'), manifest);
  const workspace = path.join(root, 'pnpm-workspace.yaml');
  write(
    workspace,
    `catalogs:\n  ultramodern:\n    '@modern-js/renderer-solid': 'npm:${rendererPackage}@${version}'\n`,
  );
  const report = auditInstalledConsumer(options);
  assert.equal(report.catalogBindings.length, 1);
  assert.deepEqual(report.catalogBindings[0], {
    name: '@modern-js/renderer-solid',
    catalog: 'ultramodern',
    declaredSpecifier: 'catalog:ultramodern',
    resolvedSpecifier: `npm:${rendererPackage}@${version}`,
    workspaceFile: 'pnpm-workspace.yaml',
    workspaceSha256: fileSha256(workspace),
  });
  assert.equal(report.edges[0].installedName, rendererPackage);
  for (const catalog of [
    `catalogs:\n  other:\n    '@modern-js/renderer-solid': 'npm:${rendererPackage}@${version}'\n`,
    `catalogs:\n  ultramodern:\n    '@modern-js/renderer-solid': 'npm:wrong-package@${version}'\n`,
    `catalogs:\n  ultramodern:\n    '@modern-js/renderer-solid': 'npm:${rendererPackage}@^${version}'\n`,
    `catalogs:\n  ultramodern:\n    '@modern-js/renderer-solid': 'npm:${rendererPackage}@${version}'\n    '@modern-js/renderer-solid': 'npm:${rendererPackage}@${version}'\n`,
  ]) {
    write(workspace, catalog);
    assert.throws(
      () => auditInstalledConsumer(options),
      /catalog|identity mismatch|canonical mapped identity/iu,
    );
  }
});

test('catalogs cannot retarget canonical renderer keys or repair leaked published dependency protocols', t => {
  const { options, root } = consumerFixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  manifest.dependencies['@modern-js/renderer-solid'] = 'catalog:ultramodern';
  writeJson(path.join(root, 'package.json'), manifest);
  write(
    path.join(root, 'pnpm-workspace.yaml'),
    `catalogs:\n  ultramodern:\n    '@modern-js/renderer-solid': 'npm:@bleedingdev/modern-js-renderer-octane@${version}'\n`,
  );
  installFixture(root, '@bleedingdev/modern-js-renderer-octane');
  fs.unlinkSync(path.join(root, 'node_modules/@modern-js/renderer-solid'));
  fs.symlinkSync(
    '../@bleedingdev/modern-js-renderer-octane',
    path.join(root, 'node_modules/@modern-js/renderer-solid'),
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...options,
        exactPackages: { '@modern-js/renderer-solid': version },
      }),
    /canonical mapped identity/u,
  );

  const leaking = consumerFixture(t);
  const providerManifest = path.join(
    leaking.root,
    'node_modules',
    rendererPackage,
    'package.json',
  );
  const provider = JSON.parse(fs.readFileSync(providerManifest));
  provider.dependencies = { 'neutral-helper': 'catalog:ultramodern' };
  writeJson(providerManifest, provider);
  installFixture(leaking.root, 'neutral-helper');
  write(
    path.join(leaking.root, 'pnpm-workspace.yaml'),
    `catalogs:\n  ultramodern:\n    neutral-helper: '${version}'\n`,
  );
  assert.throws(
    () => auditInstalledConsumer(leaking.options),
    /leaks an unresolved catalog dependency/u,
  );
});

function workspaceAuthoringFixture(t) {
  const { options, root } = consumerFixture(t);
  const leaf = path.join(root, 'apps', 'shell-super-app');
  writeJson(
    path.join(leaf, 'package.json'),
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'))),
  );
  const generatorName = '@bleedingdev/modern-js-ultramodern-create';
  writeJson(path.join(root, 'package.json'), {
    name: 'generated-workspace',
    devDependencies: { [generatorName]: version },
  });
  const generator = installFixture(root, generatorName, {
    dependencies: {
      react: version,
      '@rsbuild/plugin-react': version,
      [rendererPackage]: version,
    },
  });
  installFixture(generator, 'react');
  installFixture(generator, '@rsbuild/plugin-react');
  return {
    root,
    leaf,
    generatorName,
    generator,
    options: { ...options, applicationRoot: 'apps/shell-super-app' },
  };
}

test('a real separate root dev-only mapped generator keeps its full authoring graph out of native production', t => {
  const { options, generatorName } = workspaceAuthoringFixture(t);
  const report = auditInstalledConsumer(options);
  assert.deepEqual(
    report.closure.map(record => record.name).sort(),
    [rendererPackage, 'solid-js'].sort(),
  );
  assert.equal(report.authoringDevelopment.roots.length, 1);
  assert.equal(report.authoringDevelopment.roots[0].name, generatorName);
  assert.deepEqual(
    report.authoringDevelopment.closure.map(record => record.name).sort(),
    ['react', '@rsbuild/plugin-react', generatorName].sort(),
  );
  const shared = report.authoringDevelopment.edges.find(
    edge => edge.installedName === rendererPackage,
  );
  assert.equal(shared.targetReachability, 'selected-native');
  assert.ok(
    report.authoringDevelopment.closure.every(record =>
      /^[a-f\d]{64}$/u.test(record.manifestSha256),
    ),
  );
});

test('generator placement and native reachability take precedence over development authoring classification', t => {
  for (const injection of [
    'workspace-production',
    'app-production',
    'app-development',
    'native-import',
    'native-types',
    'native-compiler',
    'native-relative',
    'native-direct-file',
    'native-internal-manifest',
  ]) {
    const { root, leaf, generatorName, generator, options } =
      workspaceAuthoringFixture(t);
    if (injection === 'workspace-production')
      writeJson(path.join(root, 'package.json'), {
        name: 'generated-workspace',
        dependencies: { [generatorName]: version },
        devDependencies: { [generatorName]: version },
      });
    else if (
      injection === 'app-production' ||
      injection === 'app-development'
    ) {
      const file = path.join(leaf, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(file));
      manifest[
        injection === 'app-production' ? 'dependencies' : 'devDependencies'
      ] = { ...manifest.dependencies, [generatorName]: version };
      writeJson(file, manifest);
    } else if (injection === 'native-import')
      write(
        path.join(root, 'dist/server.mjs'),
        `import {native} from '${generatorName}'; void native;\n`,
      );
    else if (injection === 'native-types')
      write(
        path.join(root, 'node_modules', rendererPackage, 'index.d.ts'),
        `export type {native} from '${generatorName}';\n`,
      );
    else if (injection === 'native-relative')
      write(
        path.join(root, 'dist/server.mjs'),
        `export {native} from '../node_modules/${generatorName}/index.js';\n`,
      );
    else if (injection === 'native-direct-file')
      options.entryFiles.push(`node_modules/${generatorName}/index.js`);
    else if (injection === 'native-internal-manifest') {
      writeJson(path.join(generator, 'section/package.json'), {
        name: 'neutral-inner-section',
        version,
      });
      write(
        path.join(generator, 'section/index.js'),
        'export const native = true;\n',
      );
      write(
        path.join(root, 'dist/server.mjs'),
        `export {native} from '../node_modules/${generatorName}/section/index.js';\n`,
      );
    } else {
      writeJson(path.join(root, 'package.json'), {
        name: 'generated-workspace',
        devDependencies: {
          [generatorName]: version,
          '@rsbuild/plugin-react': version,
        },
      });
      fs.mkdirSync(path.join(root, 'node_modules', '@rsbuild'), {
        recursive: true,
      });
      fs.symlinkSync(
        path.join(generator, 'node_modules', '@rsbuild/plugin-react'),
        path.join(root, 'node_modules', '@rsbuild/plugin-react'),
      );
    }
    assert.throws(
      () => auditInstalledConsumer(options),
      /forbidden React\/RSC/u,
      injection,
    );
  }
});

test('selected nested installations outrank recorded ancestors and enforce canonical source import identities', t => {
  for (const injection of ['relative-nested', 'shadowed-canonical']) {
    const { root, options } = consumerFixture(t);
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    writeJson(manifestPath, {
      ...manifest,
      dependencies: { ...manifest.dependencies, 'neutral-host': version },
    });
    const host = installFixture(root, 'neutral-host');
    if (injection === 'relative-nested') {
      const nested = installFixture(host, 'nested-native', {
        dependencies: { '@rsbuild/plugin-react': version },
      });
      installFixture(nested, '@rsbuild/plugin-react');
      write(
        path.join(host, 'index.js'),
        "export { native } from './node_modules/nested-native/index.js';\n",
      );
    } else {
      installFixture(host, '@modern-js/renderer-solid', {
        name: '@bleedingdev/modern-js-renderer-octane',
      });
      write(
        path.join(host, 'index.js'),
        "export { native } from '@modern-js/renderer-solid';\n",
      );
    }
    write(
      path.join(root, 'dist/server.mjs'),
      "export { native } from 'neutral-host';\n",
    );
    assert.throws(
      () => auditInstalledConsumer(options),
      injection === 'relative-nested'
        ? /forbidden React\/RSC/u
        : /Selected framework import .* canonical mapped identity/u,
      injection,
    );
  }
});

test('selected JavaScript module scopes retain their exact format bytes and existing owner', t => {
  const { root, options } = consumerFixture(t);
  const output = path.join(root, '.output');
  writeJson(path.join(output, 'package.json'), { type: 'module' });
  writeJson(path.join(output, 'worker', 'package.json'), { type: 'commonjs' });
  write(
    path.join(output, 'server', 'index.js'),
    "export { native } from '@modern-js/renderer-solid';\nexport { marker } from '../worker/index.js';\n",
  );
  write(
    path.join(output, 'worker', 'index.js'),
    'module.exports = { marker: true };\n',
  );
  const report = auditInstalledConsumer({
    ...options,
    entryFiles: [...options.entryFiles, '.output/server/index.js'],
  });
  assert.deepEqual(report.moduleFormatScopes, [
    {
      path: '.output/package.json',
      sha256: fileSha256(path.join(output, 'package.json')),
      type: 'module',
    },
    {
      path: '.output/worker/package.json',
      sha256: fileSha256(path.join(output, 'worker', 'package.json')),
      type: 'commonjs',
    },
  ]);
  assert.deepEqual(
    report.closure.map(item => item.name),
    [rendererPackage, 'solid-js'],
  );
  assert(
    report.entryClosure.some(item => item.path === '.output/server/index.js'),
  );
  assert(
    report.entryClosure.some(item => item.path === '.output/worker/index.js'),
  );
  const workerScope = path.join(output, 'worker', 'package.json');
  const readFile = fs.readFileSync;
  let mutated = false;
  const reader = t.mock.method(fs, 'readFileSync', (file, ...args) => {
    const bytes = readFile(file, ...args);
    if (file === workerScope && !mutated) {
      mutated = true;
      writeJson(workerScope, { type: 'module' });
    }
    return bytes;
  });
  try {
    assert.throws(
      () =>
        auditInstalledConsumer({
          ...options,
          entryFiles: [...options.entryFiles, '.output/worker/index.js'],
        }),
      /Module format scope changed/u,
    );
    assert.equal(mutated, true);
  } finally {
    reader.mock.restore();
  }
});

test('module scopes cannot hide partial identities, invalid formats, or symlinked manifests', t => {
  const { root, options } = consumerFixture(t);
  const scope = path.join(root, 'output', 'package.json');
  write(path.join(root, 'output', 'entry.js'), 'export const native = true;\n');
  const scopedOptions = {
    ...options,
    entryFiles: [...options.entryFiles, 'output/entry.js'],
  };
  for (const manifest of [
    { type: 'invalid' },
    { type: 'module', name: 'partial-owner' },
    { type: 'module', version: '1.0.0' },
    { type: 'module', private: true },
    { type: 'module', dependencies: {} },
  ]) {
    writeJson(scope, manifest);
    assert.throws(
      () => auditInstalledConsumer(scopedOptions),
      /invalid owning package identity/u,
    );
  }
  write(scope, '{"type":');
  assert.throws(() => auditInstalledConsumer(scopedOptions), SyntaxError);
  writeJson(path.join(root, 'other-scope.json'), { type: 'module' });
  fs.unlinkSync(scope);
  fs.symlinkSync('../other-scope.json', scope);
  assert.throws(
    () => auditInstalledConsumer(scopedOptions),
    /ordinary consumer package manifest/u,
  );
});

test('selected installed roots require complete package identity even when their manifest declares a module format', t => {
  const { root, options } = consumerFixture(t);
  const installed = installFixture(root, 'scope-only-installed');
  const selectedOptions = {
    ...options,
    entryFiles: [
      ...options.entryFiles,
      'node_modules/scope-only-installed/index.js',
    ],
  };
  for (const type of ['module', 'commonjs']) {
    writeJson(path.join(installed, 'package.json'), { type });
    assert.throws(
      () => auditInstalledConsumer(selectedOptions),
      /invalid owning package identity/u,
    );
  }
  fs.unlinkSync(path.join(installed, 'package.json'));
  assert.throws(
    () => auditInstalledConsumer(selectedOptions),
    /no actual owning package manifest/u,
  );
});

test('exact root-dev native AST alias records validator usage alongside the current native checker', t => {
  const { root, generator, generatorName, options } =
    workspaceAuthoringFixture(t);
  writeJson(path.join(root, 'package.json'), {
    name: 'generated-workspace',
    devDependencies: {
      [generatorName]: version,
      typescript: '7.0.2',
      '@typescript/native': 'npm:typescript@7.0.2',
    },
  });
  installFixture(root, 'typescript', { version: '7.0.2' });
  const ast = installFixture(generator, 'typescript', {
    version: '7.0.2',
    exports: {
      './unstable/ast': './unstable/ast.js',
      './unstable/sync': './unstable/sync.js',
    },
  });
  write(path.join(ast, 'unstable/ast.js'), 'export const native = true;\n');
  write(path.join(ast, 'unstable/sync.js'), 'export const native = true;\n');
  fs.mkdirSync(path.join(root, 'node_modules/@typescript'), {
    recursive: true,
  });
  fs.symlinkSync(ast, path.join(root, 'node_modules/@typescript/native'));
  const validator = path.join(
    generator,
    'dist/esm-node/ultramodern-workspace/validation/architecture.js',
  );
  write(
    validator,
    "export function validate(workspaceRequire) { workspaceRequire('@typescript/native/unstable/ast'); workspaceRequire('@typescript/native/unstable/sync'); }\n",
  );
  options.exactPackages.typescript = '7.0.2';
  const report = auditInstalledConsumer(options);
  const tool = report.authoringDevelopment.roots.find(
    item => item.installationName === '@typescript/native',
  );
  assert.equal(tool.name, 'typescript');
  assert.equal(tool.version, '7.0.2');
  assert.equal(tool.usage[0].sha256, fileSha256(validator));
  assert.equal(tool.exportBindings.length, 2);
  assert.equal(
    report.closure.find(item => item.name === 'typescript').version,
    '7.0.2',
  );
  assert.equal(
    report.authoringDevelopment.closure.find(item => item.name === 'typescript')
      .version,
    '7.0.2',
  );
  const drift = installFixture(generator, 'native-compiler-drift', {
    name: 'typescript',
    version: '7.0.1',
  });
  write(
    path.join(root, 'dist/server.mjs'),
    `export {native} from ${JSON.stringify(path.relative(path.join(root, 'dist'), path.join(drift, 'index.js')))};\n`,
  );
  assert.throws(
    () => auditInstalledConsumer(options),
    /expected 7\.0\.2|transitive installed drift/u,
  );
  write(path.join(root, 'dist/server.mjs'), 'export const native = true;\n');
  write(
    validator,
    "// workspaceRequire('@typescript/native/unstable/ast'); workspaceRequire('@typescript/native/unstable/sync');\nexport const native = true;\n",
  );
  assert.throws(
    () => auditInstalledConsumer(options),
    /actual installed validator references/u,
  );
});

test('generator backend stays authoring-only and compiler drift fails after native reachability promotes it', t => {
  for (const injection of [
    'none',
    'native-source',
    'native-types',
    'root-production',
    'arbitrary-alias',
  ]) {
    const { root, generator, generatorName, options } =
      workspaceAuthoringFixture(t);
    const generatorPath = path.join(generator, 'package.json');
    const generatorPackage = JSON.parse(fs.readFileSync(generatorPath, 'utf8'));
    const backendVersion = ['native-source', 'native-types'].includes(injection)
      ? '7.0.1'
      : '7.0.2';
    generatorPackage.dependencies['@effect/tsgo'] = '0.45.0';
    generatorPackage.dependencies['@typescript/native'] =
      `npm:typescript@${backendVersion}`;
    writeJson(generatorPath, generatorPackage);
    installFixture(generator, '@effect/tsgo', { version: '0.45.0' });
    installFixture(generator, '@typescript/native', {
      name: 'typescript',
      version: backendVersion,
    });
    const workspace = {
      name: 'generated-workspace',
      dependencies: {},
      devDependencies: { [generatorName]: version, typescript: '7.0.2' },
    };
    installFixture(root, 'typescript', { version: '7.0.2' });
    options.exactPackages.typescript = '7.0.2';
    if (injection === 'root-production' || injection === 'arbitrary-alias') {
      const backendVersion = '7.0.1';
      workspace[
        injection === 'root-production' ? 'dependencies' : 'devDependencies'
      ]['@typescript/native'] = `npm:typescript@${backendVersion}`;
      installFixture(root, '@typescript/native', {
        name: 'typescript',
        version: backendVersion,
      });
    }
    writeJson(path.join(root, 'package.json'), workspace);
    const backend = `../node_modules/${generatorName}/node_modules/@typescript/native/index.js`;
    if (injection === 'native-source')
      write(
        path.join(root, 'dist/server.mjs'),
        `export { native } from '${backend}';\n`,
      );
    if (injection === 'native-types')
      write(
        path.join(root, 'src/entry.tsx'),
        `export type { native } from '${backend}';\n`,
      );
    if (injection !== 'none')
      assert.throws(
        () => auditInstalledConsumer(options),
        /expected 7\.0\.2|transitive installed drift/u,
        injection,
      );
    else {
      const report = auditInstalledConsumer(options);
      assert.ok(
        report.authoringDevelopment.edges.some(
          edge =>
            edge.name === '@typescript/native' &&
            edge.block === 'dependencies' &&
            edge.installedName === 'typescript' &&
            edge.version === '7.0.2',
        ),
      );
      assert.ok(
        report.authoringDevelopment.closure.some(
          record => record.name === 'typescript' && record.version === '7.0.2',
        ),
      );
      assert.equal(
        report.closure.find(record => record.name === 'typescript').version,
        '7.0.2',
      );
    }
  }
});

test('authenticated packed ESM and CJS locators audit the actual helper through a virtual require anchor', t => {
  for (const format of ['esm', 'cjs', 'cjs-interop']) {
    const fixture = anchoredConsumerFixture(t, format);
    assert.equal(
      execFileSync(process.execPath, [fixture.entry], {
        cwd: fixture.root,
        encoding: 'utf8',
      }).trim(),
      'true',
    );
    let report;
    assert.doesNotThrow(() => {
      report = auditInstalledConsumer(fixture.options);
    }, format);
    assert.equal(report.ownedRequireAnchors.length, 1);
    const anchor = report.ownedRequireAnchors[0];
    const helper = path.join(fixture.installed, 'src/private/helper.cjs');
    const sentinel = path.join(fixture.installed, 'src/private/sentinel.cjs');
    assert.equal(anchor.kind, 'package');
    assert.equal(anchor.artifactSha256, fixture.artifact.sha256);
    assert.equal(anchor.source, path.relative(fixture.root, fixture.entry));
    assert.equal(anchor.sourceSha256, fileSha256(fixture.entry));
    assert.equal(
      anchor.logicalAnchor,
      path.relative(
        fixture.root,
        path.join(fixture.installed, 'src/private/index.cjs'),
      ),
    );
    assert.equal(
      fs.existsSync(path.resolve(fixture.root, anchor.logicalAnchor)),
      false,
    );
    assert.deepEqual(anchor.sentinel, {
      path: path.relative(fixture.root, sentinel),
      sha256: fileSha256(sentinel),
    });
    assert.equal(anchor.target, path.relative(fixture.root, helper));
    assert.equal(anchor.targetSha256, fileSha256(helper));
    assert(
      report.entryClosure.some(
        file =>
          file.path === anchor.target && file.sha256 === anchor.targetSha256,
      ),
    );
    assert.deepEqual(anchor.packageScopes, [
      {
        path: path.relative(
          fixture.root,
          path.join(fixture.installed, 'package.json'),
        ),
        sha256: fileSha256(path.join(fixture.installed, 'package.json')),
        type: format === 'esm' ? 'module' : 'commonjs',
      },
    ]);
  }
});

test('authenticated locators reject altered control flow, computed paths, and require bindings', t => {
  for (const mutation of [
    'early-return',
    'side-effect',
    'computed-path',
    'guard',
    'cursor',
    'unknown-anchor',
    'mutable-require',
    'shadow-factory',
  ]) {
    const fixture = anchoredConsumerFixture(
      t,
      mutation === 'shadow-factory' ? 'cjs' : 'esm',
      mutation,
    );
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /Unverifiable createRequire anchor/u,
      mutation,
    );
  }
});

test('anchor primitives reject Node property mutation, escapes, ambient writes, and substituted interop', t => {
  for (const [format, mutation] of [
    ['esm', 'path-write'],
    ['cjs', 'module-write'],
    ['esm', 'module-escape'],
    ['cjs', 'secondary-alias-write'],
    ['cjs', 'dirname-write'],
    ['cjs', 'interop-substitution'],
    ['cjs', 'interop-rewrite'],
    ['cjs-interop', 'object-alias-write'],
    ['cjs-interop', 'object-prototype-write'],
    ['cjs-interop', 'object-escape'],
    ['cjs-interop', 'interop-expression-substitution'],
  ]) {
    const fixture = anchoredConsumerFixture(t, format, mutation);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /Unverifiable createRequire anchor/u,
      mutation,
    );
  }
});

test('package require locators require genuine archive authority and the actual guarded owner', t => {
  const fixture = anchoredConsumerFixture(t);
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        releaseArtifacts: undefined,
      }),
    /requires authenticated release ownership/u,
  );
  for (const mutation of ['foreign-root', 'missing-sentinel']) {
    const changed = anchoredConsumerFixture(t, 'esm', mutation);
    assert.throws(
      () => auditInstalledConsumer(changed.options),
      /foreign package root|no authenticated owning root/u,
      mutation,
    );
  }
});

test('anchored helpers remain subject to forbidden runtime and unresolved dependency checks', t => {
  for (const mutation of ['forbidden-helper', 'missing-helper-dependency']) {
    const fixture = anchoredConsumerFixture(t, 'esm', mutation);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /forbidden React\/RSC module react|Unresolved installed entry import undeclared-helper-runtime/u,
      mutation,
    );
  }
});

test('package require anchors reject changed module, helper, sentinel, or owner bytes and symlinks', t => {
  const fixture = anchoredConsumerFixture(t);
  for (const relative of [
    'dist/entry.mjs',
    'src/private/helper.cjs',
    'src/private/sentinel.cjs',
    'package.json',
  ]) {
    const file = path.join(fixture.installed, relative);
    const bytes = fs.readFileSync(file);
    fs.appendFileSync(file, '\n');
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /differs from candidate artifact bytes|differs from authenticated/u,
      relative,
    );
    write(file, bytes);
  }
  const helper = path.join(fixture.installed, 'src/private/helper.cjs');
  const bytes = fs.readFileSync(helper);
  fs.rmSync(helper);
  fs.symlinkSync('sentinel.cjs', helper);
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /non-regular packed file|symbolic link/u,
  );
  fs.rmSync(helper);
  write(helper, bytes);
});

test('ordinary Node file anchors preserve lexical aliases and require export conditions', t => {
  const { root, options } = consumerFixture(t);
  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.dependencies['condition-provider'] = version;
  writeJson(manifestPath, manifest);
  const provider = installFixture(root, 'condition-provider', {
    exports: { '.': { import: './esm.mjs', require: './cjs.cjs' } },
  });
  write(path.join(provider, 'esm.mjs'), "export const value = 'ESM';\n");
  write(path.join(provider, 'cjs.cjs'), "module.exports = { value: 'CJS' };\n");
  const entry = path.join(root, 'src/anchor.mjs');
  write(
    entry,
    "import { createRequire as makeRequire } from 'node:module';\nconst load = makeRequire(import.meta.url);\nconst filename = load.resolve('condition-provider');\nconsole.log(load('condition-provider').value);\n",
  );
  assert.equal(
    execFileSync(process.execPath, [entry], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    'CJS',
  );
  const report = auditInstalledConsumer({
    ...options,
    entryFiles: ['src/anchor.mjs'],
  });
  assert.equal(report.ownedRequireAnchors[0].kind, 'file');
  assert.equal(report.ownedRequireAnchors[0].logicalAnchor, 'src/anchor.mjs');
  assert(
    report.entryClosure.some(file =>
      file.path.endsWith('condition-provider/cjs.cjs'),
    ),
  );
  assert(
    !report.entryClosure.some(file =>
      file.path.endsWith('condition-provider/esm.mjs'),
    ),
  );
});

test('createRequire metadata resolution does not load or enqueue resolved module bodies', t => {
  const { root, options } = consumerFixture(t);
  const entry = path.join(root, 'src/metadata.mjs');
  const helper = path.join(root, 'src/helper.cjs');
  write(helper, "throw new Error('Metadata resolver loaded a module');\n");
  write(
    entry,
    `import { createRequire } from 'node:module';
function resolveProfile(registration) {
  const require = createRequire(import.meta.url);
  return [
    { specifier: 'helper', filename: require.resolve('./helper.cjs') },
    ...registration.frameworkModules.map(module => ({
      specifier: module.specifier,
      filename: require.resolve(module.request),
    })),
  ];
}
function resolveFilename(filename, request) {
  const resolver = createRequire(filename);
  return resolver.resolve(request);
}
console.log(resolveProfile({ frameworkModules: [{ specifier: 'helper', request: './helper.cjs' }] }).length);
console.log(resolveFilename(new URL(import.meta.url), './helper.cjs'));
`,
  );
  const output = execFileSync(process.execPath, [entry], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  assert.deepEqual(output, ['2', helper]);
  const report = auditInstalledConsumer({
    ...options,
    entryFiles: ['src/metadata.mjs'],
  });
  assert.equal(report.ownedRequireAnchors.length, 0);
  assert(!report.entryClosure.some(item => item.path === 'src/helper.cjs'));
});

test('metadata require references still reject resolution writes and escapes', t => {
  for (const use of [
    "load.resolve = () => '/foreign';\nload.resolve('./helper.cjs');",
    "const lookup = load.resolve;\nlookup('./helper.cjs');",
    "const alias = load;\nalias.resolve('./helper.cjs');",
    'consume(load.resolve);',
    "load['resolve']('./helper.cjs');",
  ]) {
    const { root, options } = consumerFixture(t);
    write(
      path.join(root, 'src/metadata.mjs'),
      `import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\n${use}\n`,
    );
    write(path.join(root, 'src/helper.cjs'), 'module.exports = {};\n');
    assert.throws(
      () =>
        auditInstalledConsumer({
          ...options,
          entryFiles: ['src/metadata.mjs'],
        }),
      /Unverifiable createRequire anchor/u,
      use,
    );
  }
});

test('unknown, mutable, or escaped ordinary require anchors fail instead of using the source directory', t => {
  for (const source of [
    "import { createRequire } from 'node:module';\nconst load = createRequire(process.env.UNKNOWN_ANCHOR);\nload('./helper.cjs');\n",
    "import { createRequire } from 'node:module';\nlet load = createRequire(import.meta.url);\nload = () => true;\nload('./helper.cjs');\n",
    "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nconst escaped = load;\nescaped('./helper.cjs');\n",
    "function createRequire() { return () => true; }\nconst load = createRequire('index.cjs');\nload('./helper.cjs');\n",
  ]) {
    const { root, options } = consumerFixture(t);
    write(path.join(root, 'src/anchor.mjs'), source);
    write(path.join(root, 'src/helper.cjs'), 'module.exports = {};\n');
    assert.throws(
      () =>
        auditInstalledConsumer({ ...options, entryFiles: ['src/anchor.mjs'] }),
      /Unverifiable createRequire anchor/u,
    );
  }
});

test('ordinary require anchors reject a symlinked selected helper before realpath', t => {
  const { root, options } = consumerFixture(t);
  write(
    path.join(root, 'src/anchor.mjs'),
    "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nload('./helper.cjs');\n",
  );
  write(path.join(root, 'src/real.cjs'), 'module.exports = {};\n');
  fs.symlinkSync('real.cjs', path.join(root, 'src/helper.cjs'));
  assert.throws(
    () =>
      auditInstalledConsumer({ ...options, entryFiles: ['src/anchor.mjs'] }),
    /createRequire target contains a symbolic link/u,
  );
});

test('CJS file anchors use genuine ambient filenames and reject their reassignment', t => {
  for (const [ambient, expression] of [
    ['__filename', '__filename'],
    ['__dirname', "nodePath.join(__dirname, 'virtual.cjs')"],
  ]) {
    const { root, options } = consumerFixture(t);
    const entry = path.join(root, 'src/anchor.cjs');
    const source = `const nodeModule = require('node:module');\nconst nodePath = require('node:path');\nconst load = nodeModule.createRequire(${expression});\nconsole.log(load('./helper.cjs').native);\n`;
    write(entry, source);
    write(
      path.join(root, 'src/helper.cjs'),
      'module.exports = { native: true };\n',
    );
    assert.equal(
      execFileSync(process.execPath, [entry], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      'true',
    );
    assert.equal(
      auditInstalledConsumer({ ...options, entryFiles: ['src/anchor.cjs'] })
        .ownedRequireAnchors.length,
      1,
    );
    for (const assignment of [
      `${ambient} = '/foreign';`,
      `({ value: ${ambient} } = { value: '/foreign' });`,
    ]) {
      write(entry, `${assignment}\n${source}`);
      assert.throws(
        () =>
          auditInstalledConsumer({
            ...options,
            entryFiles: ['src/anchor.cjs'],
          }),
        /Unverifiable createRequire anchor/u,
        assignment,
      );
    }
  }
});

test('authenticated framework cohort aliases bind present optional peers to physical package identity and bytes', t => {
  const fixture = anchoredConsumerFixture(t);
  const sourceName = '@modern-js/renderer-solid';
  const alias = `npm:${rendererPackage}@${version}`;
  const manifestFile = path.join(fixture.root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.dependencies['ordinary-peer-owner'] = '1.0.0';
  writeJson(manifestFile, manifest);
  installFixture(fixture.root, 'ordinary-peer-owner', {
    version: '1.0.0',
    peerDependencies: { [sourceName]: version },
    peerDependenciesMeta: { [sourceName]: { optional: true } },
  });
  const workspaceFile = path.join(fixture.root, 'pnpm-workspace.yaml');
  const workspace = `overrides:\n  '${sourceName}': '${alias}'\n`;
  write(workspaceFile, workspace);
  const report = auditInstalledConsumer(fixture.options);
  const edge = report.edges.find(
    item => item.from === 'ordinary-peer-owner' && item.name === sourceName,
  );
  assert.equal(edge.block, 'peerDependencies');
  assert.equal(edge.declaredSpecifier, version);
  assert.equal(edge.resolvedSpecifier, alias);
  assert.equal(edge.installedName, rendererPackage);
  assert.equal(edge.version, version);
  assert.deepEqual(edge.workspaceAliasBinding, {
    name: sourceName,
    specifier: alias,
    targetName: rendererPackage,
    version,
    declarations: [
      {
        owner: rendererPackage,
        ownerVersion: version,
        artifactSha256: fixture.artifact.sha256,
        block: 'release-package-identity',
      },
    ],
    workspaceFile: 'pnpm-workspace.yaml',
    workspaceSha256: fileSha256(workspaceFile),
  });
  assert.equal(
    report.producerArtifactBindings[0].artifactSha256,
    fixture.artifact.sha256,
  );
  assert.equal(
    report.producerArtifactBindings[0].frameworkCohortDigest,
    fixture.options.releaseArtifacts.cohortDigest,
  );
  for (const invalid of [
    `npm:@bleedingdev/modern-js-i18n-utils@${version}`,
    `npm:${rendererPackage}@1.0.1`,
  ]) {
    write(workspaceFile, `overrides:\n  '${sourceName}': '${invalid}'\n`);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /Workspace alias .* differs from its authenticated archive declaration/u,
    );
  }
  write(workspaceFile, workspace);
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        releaseArtifacts: undefined,
      }),
    /no authenticated archive declaration/u,
  );
  const packedManifestFile = path.join(fixture.installed, 'package.json');
  const packedManifestBytes = fs.readFileSync(packedManifestFile);
  const packedManifest = JSON.parse(packedManifestBytes);
  for (const change of [
    { name: '@bleedingdev/modern-js-wrong-target' },
    { version: '1.0.1' },
  ]) {
    writeJson(packedManifestFile, { ...packedManifest, ...change });
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /identity mismatch|version .* differs/u,
    );
  }
  write(packedManifestFile, packedManifestBytes);
  const target = path.join(fixture.installed, 'index.d.ts');
  fs.appendFileSync(target, '\n');
  assert.throws(
    () => auditInstalledConsumer(fixture.options),
    /differs from candidate artifact bytes/u,
  );
});

test('ordinary require anchors retain the initial context manifest byte authority', t => {
  const { root, options } = consumerFixture(t);
  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  installFixture(root, 'injected-anchor-dependency');
  write(
    path.join(root, 'src/anchor.mjs'),
    "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nload('./helper.cjs');\n",
  );
  write(path.join(root, 'src/helper.cjs'), 'module.exports = {};\n');
  const readFile = fs.readFileSync;
  let mutated = false;
  const reader = t.mock.method(fs, 'readFileSync', (file, ...args) => {
    const bytes = readFile(file, ...args);
    if (file === manifestPath && !mutated) {
      mutated = true;
      writeJson(manifestPath, {
        ...manifest,
        dependencies: {
          ...manifest.dependencies,
          'injected-anchor-dependency': version,
        },
      });
    }
    return bytes;
  });
  try {
    assert.throws(
      () =>
        auditInstalledConsumer({ ...options, entryFiles: ['src/anchor.mjs'] }),
      /createRequire package scope changed from its initial manifest bytes/u,
    );
    assert.equal(mutated, true);
  } finally {
    reader.mock.restore();
  }
});

test('implicit declaration siblings and type-only root export targets are checked', t => {
  const { options, root } = consumerFixture(t);
  const directory = path.join(root, 'node_modules', rendererPackage);
  const manifest = path.join(directory, 'package.json');
  writeJson(manifest, {
    ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
    exports: './index.js',
  });
  write(
    path.join(directory, 'index.d.ts'),
    "export type{ReactNode}from'react';\n",
  );
  assert.throws(() => auditInstalledConsumer(options), /forbidden React\/RSC/u);
  write(
    path.join(directory, 'index.d.ts'),
    'export declare const native: boolean;\n',
  );
  writeJson(manifest, {
    ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
    exports: { types: 'index.d.ts', default: './index.js' },
  });
  assert.throws(
    () => auditInstalledConsumer(options),
    /unsafe export target index\.d\.ts/u,
  );
});

test('raw native TSRX cannot be certified by the generic source parser', t => {
  const { options, root } = consumerFixture(t);
  write(
    path.join(root, 'src', 'entry.tsrx'),
    'const Component = @{<main>native</main>};\n',
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...options,
        renderer: 'octane',
        entryFiles: ['src/entry.tsrx', 'dist/server.mjs'],
      }),
    /Native \.tsrx source closure requires a compiler-owned source module manifest/u,
  );
});

test('declaration .js references resolve their native type files and native type references', t => {
  const { options, root } = consumerFixture(t);
  const directory = path.join(root, 'node_modules', rendererPackage);
  write(
    path.join(directory, 'index.d.ts'),
    "/// <reference types='solid-js'/>\nimport type { Native } from './native.js';\nexport declare const native: Native;\n",
  );
  write(path.join(directory, 'native.js'), 'export const native=true;\n');
  write(
    path.join(directory, 'native.d.ts'),
    "import type{ReactNode}from'react'; export type Native=ReactNode;\n",
  );
  assert.throws(
    () => auditInstalledConsumer(options),
    /forbidden React\/RSC module react/u,
  );
});

test('selected physical ambient declarations resolve exact type names without admitting runtime loads', t => {
  const fixture = declarationConsumerFixture(t);
  const source = path.join(fixture.owner, 'future-types.d.ts');
  const target = path.join(fixture.owner, 'ambient-target.d.ts');
  write(
    source,
    '/// <reference path="./ambient-target.d.ts" />\nexport type Future = typeof import("fixture-stream/iter");\n',
  );
  write(
    target,
    'declare module "fixture-stream/iter" { export const native: true; }\n',
  );
  const input = {
    ...fixture.options,
    entryFiles: [
      ...fixture.options.entryFiles,
      path.relative(fixture.root, source),
    ],
  };
  const report = auditInstalledConsumer(input);
  assert.deepEqual(report.ambientTypeImports, [
    {
      source: path.relative(fixture.root, source),
      sourceSha256: fileSha256(source),
      specifier: 'fixture-stream/iter',
      provider: 'declaration-owner',
      providerManifestSha256: fileSha256(
        path.join(fixture.owner, 'package.json'),
      ),
      target: path.relative(fixture.root, target),
      targetSha256: fileSha256(target),
      role: 'runtime',
    },
  ]);
  assert(
    report.entryClosure.some(
      item =>
        item.path === path.relative(fixture.root, target) &&
        item.sha256 === fileSha256(target),
    ),
  );
  assert(
    !report.declarationFallbacks.some(
      item => item.specifier === 'fixture-stream/iter',
    ),
  );
  const runtime = path.join(fixture.owner, 'runtime.js');
  write(
    runtime,
    "import { native } from 'fixture-stream/iter'; void native;\n",
  );
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...input,
        entryFiles: [...input.entryFiles, path.relative(fixture.root, runtime)],
      }),
    /Unresolved installed entry import fixture-stream\/iter/u,
  );
  write(
    source,
    '/// <reference path="./ambient-target.d.ts" />\nexport type Foreign = import("undeclared-foreign-type").Model;\n',
  );
  assert.throws(
    () => auditInstalledConsumer(input),
    /Declaration fallback @types\/undeclared-foreign-type requires its owner's declared production dependency/u,
  );
});

test('ambient declaration exports preserve imported dependency traversal and JavaScript export validation', t => {
  const fixture = declarationConsumerFixture(t);
  const source = path.join(fixture.owner, 'timers.d.ts');
  write(
    source,
    'declare module "fixture-timers" {\n  import * as promises from "declaration-model";\n  export { promises };\n}\n',
  );
  const report = auditInstalledConsumer({
    ...fixture.options,
    entryFiles: [
      ...fixture.options.entryFiles,
      path.relative(fixture.root, source),
    ],
  });
  const binding = report.declarationFallbacks.find(
    item => item.source === path.relative(fixture.root, source),
  );
  assert.equal(binding.specifier, 'declaration-model');
  assert.equal(binding.provider, fixture.providerName);
  assert.equal(binding.sourceSha256, fileSha256(source));
  assert.equal(binding.targetSha256, fileSha256(fixture.target));
  assert(
    report.entryClosure.some(
      item =>
        item.path === path.relative(fixture.root, fixture.target) &&
        item.sha256 === fileSha256(fixture.target),
    ),
  );
  const runtime = path.join(fixture.root, 'src/invalid-export.js');
  write(runtime, 'export { missing };\n');
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...fixture.options,
        entryFiles: [path.relative(fixture.root, runtime)],
      }),
    /Export 'missing' is not defined/u,
  );
});

test('declaration imports select an owner-declared physical types provider and retain its bytes', t => {
  for (const extension of ['.d.ts', '.d.mts', '.d.cts']) {
    const fixture = declarationConsumerFixture(t);
    const source = path.join(fixture.owner, `model${extension}`);
    write(source, fs.readFileSync(fixture.source));
    const report = auditInstalledConsumer({
      ...fixture.options,
      entryFiles: [
        ...fixture.options.entryFiles,
        path.relative(fixture.root, source),
      ],
    });
    const binding = report.declarationFallbacks.find(
      item => item.source === path.relative(fixture.root, source),
    );
    assert.equal(binding.specifier, 'declaration-model');
    assert.equal(binding.owner, 'declaration-owner');
    assert.equal(binding.dependencyBlock, 'dependencies');
    assert.equal(binding.declaredSpecifier, '1.2.3');
    assert.equal(binding.provider, fixture.providerName);
    assert.equal(binding.providerVersion, '1.2.3');
    for (const [key, file] of [
      ['source', source],
      ['ownerManifest', path.join(fixture.owner, 'package.json')],
      ['providerManifest', path.join(fixture.provider, 'package.json')],
      ['target', fixture.target],
    ]) {
      assert.equal(binding[key], path.relative(fixture.root, file));
      assert.equal(binding[`${key}Sha256`], fileSha256(file));
    }
    assert(
      report.edges.some(
        edge =>
          edge.from === 'declaration-owner' &&
          edge.name === fixture.providerName &&
          edge.block === 'dependencies',
      ),
    );
    assert(
      report.entryClosure.some(
        file =>
          file.path === binding.target && file.sha256 === binding.targetSha256,
      ),
    );
  }
});

test('explicit TypeScript type imports select only their declared types provider', t => {
  for (const source of [
    "import type { Model } from 'declaration-model';\nexport type Value = Model;\n",
    "import { type Model } from 'declaration-model';\nexport type Value = Model;\n",
    "export type { Model } from 'declaration-model';\n",
    "export type Value = import('declaration-model').Model;\n",
  ]) {
    const { root, options } = consumerFixture(t);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json')),
    );
    manifest.dependencies['@types/declaration-model'] = '1.2.3';
    writeJson(path.join(root, 'package.json'), manifest);
    const provider = installFixture(root, '@types/declaration-model', {
      version: '1.2.3',
      exports: { '.': { types: './index.d.ts' } },
    });
    write(path.join(provider, 'index.d.ts'), 'export interface Model {}\n');
    write(path.join(root, 'src/entry.tsx'), source);
    const report = auditInstalledConsumer(options);
    assert.equal(report.declarationFallbacks.length, 1);
    assert.equal(report.declarationFallbacks[0].owner, 'native-consumer');
    assert.equal(
      report.declarationFallbacks[0].target,
      path.relative(root, path.join(provider, 'index.d.ts')),
    );
    assert(
      !report.entryClosure.some(
        file =>
          file.path === path.relative(root, path.join(provider, 'index.js')),
      ),
    );
  }
});

test('runtime and mixed value imports cannot be satisfied by a types-only provider', t => {
  for (const [extension, source] of [
    ['.ts', "import { Model } from 'declaration-model';\nvoid Model;\n"],
    [
      '.ts',
      "import { type Model, native } from 'declaration-model';\nvoid native;\n",
    ],
    ['.mjs', "import 'declaration-model';\n"],
    ['.cjs', "require('declaration-model');\n"],
  ]) {
    const fixture = declarationConsumerFixture(t);
    const entry = path.join(fixture.owner, `value${extension}`);
    write(entry, source);
    assert.throws(
      () =>
        auditInstalledConsumer({
          ...fixture.options,
          entryFiles: [path.relative(fixture.root, entry)],
        }),
      /Unresolved installed entry import declaration-model/u,
      extension,
    );
  }
});

test('declaration fallback requires its actual owner production dependency', t => {
  for (const block of [
    'absent',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const fixture = declarationConsumerFixture(t);
    const manifestPath = path.join(fixture.owner, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    delete manifest.dependencies;
    if (block !== 'absent')
      manifest[block] = { [fixture.providerName]: '1.2.3' };
    writeJson(manifestPath, manifest);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /requires its owner's declared production dependency/u,
      block,
    );
  }
});

test('declaration fallback rejects missing or wrongly identified production providers', t => {
  for (const variant of ['missing', 'name', 'version', 'alias']) {
    const fixture = declarationConsumerFixture(t);
    const manifestPath = path.join(fixture.provider, 'package.json');
    if (variant === 'missing') fs.rmSync(fixture.provider, { recursive: true });
    else {
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      if (variant === 'version') manifest.version = '1.2.4';
      else manifest.name = 'impostor-declarations';
      writeJson(manifestPath, manifest);
      if (variant === 'alias') {
        const ownerManifestPath = path.join(fixture.owner, 'package.json');
        const ownerManifest = JSON.parse(fs.readFileSync(ownerManifestPath));
        ownerManifest.dependencies[fixture.providerName] =
          'npm:impostor-declarations@1.2.3';
        writeJson(ownerManifestPath, ownerManifest);
      }
    }
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /Missing installed dependencies|identity mismatch|version 1\.2\.4 differs|invalid physical package identity/u,
      variant,
    );
  }
});

test('declaration fallback rejects symlinked manifests and declaration targets', t => {
  for (const variant of [
    'manifest',
    'target',
    'directory',
    'outside-package',
  ]) {
    const fixture = declarationConsumerFixture(t);
    if (variant === 'manifest') {
      const manifest = path.join(fixture.provider, 'package.json');
      const realManifest = path.join(fixture.provider, 'manifest.json');
      fs.renameSync(manifest, realManifest);
      fs.symlinkSync('manifest.json', manifest);
    } else if (variant === 'directory') {
      write(
        path.join(fixture.provider, 'actual/model.d.ts'),
        'export interface Model {}\n',
      );
      fs.symlinkSync('actual', path.join(fixture.provider, 'linked'));
      const manifest = path.join(fixture.provider, 'package.json');
      writeJson(manifest, {
        ...JSON.parse(fs.readFileSync(manifest)),
        exports: { '.': { types: './linked/model.d.ts' } },
      });
    } else if (variant === 'outside-package') {
      fs.rmSync(fixture.target);
      fs.symlinkSync(fixture.source, fixture.target);
    } else {
      fs.renameSync(fixture.target, path.join(fixture.provider, 'real.d.ts'));
      fs.symlinkSync('real.d.ts', fixture.target);
    }
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /symbolic link|contained declaration file/u,
      variant,
    );
  }
});

test('declaration fallback checks selected source siblings and directory indexes before realpath', t => {
  for (const variant of [
    'javascript-sibling',
    'directory-index',
    '.ts',
    '.mts',
    '.cts',
  ]) {
    const fixture = declarationConsumerFixture(t);
    const manifestPath = path.join(fixture.provider, 'package.json');
    const target =
      variant === 'javascript-sibling'
        ? fixture.target
        : variant === 'directory-index'
          ? path.join(fixture.provider, 'declarations/index.d.ts')
          : path.join(fixture.provider, `model.d${variant}`);
    write(target, 'export interface Model {}\n');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.exports = {
      '.': {
        types:
          variant === 'javascript-sibling'
            ? './index.js'
            : variant === 'directory-index'
              ? './declarations'
              : `./model${variant}`,
      },
    };
    writeJson(manifestPath, manifest);
    const report = auditInstalledConsumer(fixture.options);
    assert.equal(
      report.declarationFallbacks[0].target,
      path.relative(fixture.root, target),
    );
    assert.equal(
      report.declarationFallbacks[0].targetSha256,
      fileSha256(target),
    );
    if (variant.startsWith('.')) {
      const direct = path.join(fixture.provider, `model${variant}`);
      write(direct, 'export interface Model { direct: true }\n');
      assert.throws(
        () => auditInstalledConsumer(fixture.options),
        /must select a contained declaration file/u,
      );
      const rootDeclaration = path.join(
        fixture.provider,
        'relative-source.d.ts',
      );
      write(
        rootDeclaration,
        `export type { Model } from './model${variant}';\n`,
      );
      writeJson(manifestPath, {
        ...manifest,
        exports: { '.': { types: './relative-source.d.ts' } },
      });
      const selected = auditInstalledConsumer(fixture.options);
      assert.equal(
        selected.declarationFallbacks[0].target,
        path.relative(fixture.root, rootDeclaration),
      );
      assert.equal(
        selected.declarationFallbacks[0].targetSha256,
        fileSha256(rootDeclaration),
      );
      assert(
        selected.entryClosure.some(
          item =>
            item.path === path.relative(fixture.root, direct) &&
            item.sha256 === fileSha256(direct),
        ),
      );
      assert(
        !selected.entryClosure.some(
          item => item.path === path.relative(fixture.root, target),
        ),
      );
      fs.rmSync(direct);
      writeJson(manifestPath, manifest);
      const runtime = path.join(fixture.provider, 'runtime.mjs');
      write(runtime, `import value from './model${variant}'; void value;\n`);
      assert.throws(
        () =>
          auditInstalledConsumer({
            ...fixture.options,
            entryFiles: [
              ...fixture.options.entryFiles,
              path.relative(fixture.root, runtime),
            ],
          }),
        /Unresolved entry import/u,
      );
    }
    fs.renameSync(target, path.join(path.dirname(target), 'real.d.ts'));
    fs.symlinkSync('real.d.ts', target);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /Declaration fallback target contains a symbolic link/u,
      variant,
    );
  }
});

test('declaration fallback rejects a nearer source provider that differs from the owner dependency', t => {
  for (const variant of ['same-version', 'wrong-name', 'wrong-version']) {
    const fixture = declarationConsumerFixture(t);
    const sourceDirectory = path.join(fixture.owner, 'nested');
    installFixture(sourceDirectory, fixture.providerName, {
      name:
        variant === 'wrong-name'
          ? 'impostor-declarations'
          : fixture.providerName,
      version: variant === 'wrong-version' ? '1.2.4' : '1.2.3',
    });
    const source = path.join(sourceDirectory, 'model.d.ts');
    write(source, fs.readFileSync(fixture.source));
    assert.throws(
      () =>
        auditInstalledConsumer({
          ...fixture.options,
          entryFiles: [
            ...fixture.options.entryFiles,
            path.relative(fixture.root, source),
          ],
        }),
      /resolves a different provider from its source/u,
      variant,
    );
  }
});

test('declaration fallback binds the complete initial consumer context manifest bytes', t => {
  const { root, options } = consumerFixture(t);
  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.dependencies['@types/declaration-model'] = '1.2.3';
  writeJson(manifestPath, manifest);
  const provider = installFixture(root, '@types/declaration-model', {
    version: '1.2.3',
  });
  write(path.join(provider, 'index.d.ts'), 'export interface Model {}\n');
  installFixture(root, 'injected-dependency');
  write(
    path.join(root, 'src/entry.tsx'),
    "import type { Model } from 'declaration-model';\nexport type Value = Model;\n",
  );
  const readFile = fs.readFileSync;
  let mutated = false;
  const reader = t.mock.method(fs, 'readFileSync', (file, ...args) => {
    const bytes = readFile(file, ...args);
    if (file === manifestPath && !mutated) {
      mutated = true;
      writeJson(manifestPath, {
        ...manifest,
        dependencies: {
          ...manifest.dependencies,
          'injected-dependency': version,
        },
      });
    }
    return bytes;
  });
  try {
    assert.throws(
      () => auditInstalledConsumer(options),
      /Declaration fallback owner changed/u,
    );
    assert.equal(mutated, true);
  } finally {
    reader.mock.restore();
  }
});

test('declaration fallback cannot escape its provider or select a JavaScript entry', t => {
  for (const target of ['../outside.d.ts', './index.js', 'index.d.ts']) {
    const fixture = declarationConsumerFixture(t);
    const manifest = path.join(fixture.provider, 'package.json');
    writeJson(manifest, {
      ...JSON.parse(fs.readFileSync(manifest)),
      exports: { '.': { types: target } },
    });
    if (target === '../outside.d.ts')
      write(
        path.join(fixture.provider, '..', 'outside.d.ts'),
        'export interface Model {}\n',
      );
    if (target === './index.js') fs.rmSync(fixture.target);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /contained declaration file/u,
      target,
    );
  }
});

test('declaration fallback preserves scoped names, subpaths, and package export denials', t => {
  const fixture = declarationConsumerFixture(t, '@scope/model');
  write(
    fixture.source,
    "import { Model } from '@scope/model/public';\nexport declare const native: Model;\n",
  );
  const manifestPath = path.join(fixture.provider, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.exports['./public'] = { types: './public.d.ts' };
  writeJson(manifestPath, manifest);
  write(
    path.join(fixture.provider, 'public.d.ts'),
    'export interface Model {}\n',
  );
  const report = auditInstalledConsumer(fixture.options);
  assert.equal(report.declarationFallbacks[0].provider, '@types/scope__model');
  assert.equal(report.declarationFallbacks[0].specifier, '@scope/model/public');
  assert.equal(
    report.declarationFallbacks[0].target,
    path.relative(fixture.root, path.join(fixture.provider, 'public.d.ts')),
  );
  for (const denial of ['unexported', 'null', 'missing']) {
    manifest.exports = { '.': { types: './index.d.ts' } };
    if (denial !== 'unexported')
      manifest.exports['./public'] =
        denial === 'null' ? null : { types: './missing.d.ts' };
    writeJson(manifestPath, manifest);
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /No selected declaration export|Missing selected declaration export/u,
      denial,
    );
  }
});

test('declaration fallback rejects source, owner, provider, and target byte changes during audit', t => {
  for (const variant of [
    'source',
    'ownerManifest',
    'providerManifest',
    'target',
  ]) {
    const fixture = declarationConsumerFixture(t);
    const mutatedPath =
      variant === 'source'
        ? fixture.source
        : variant === 'target'
          ? fixture.target
          : path.join(
              variant === 'ownerManifest' ? fixture.owner : fixture.provider,
              'package.json',
            );
    const readFile = fs.readFileSync;
    let mutated = false;
    const reader = t.mock.method(fs, 'readFileSync', (file, ...args) => {
      const bytes = readFile(file, ...args);
      if (file === mutatedPath && !mutated) {
        mutated = true;
        fs.appendFileSync(mutatedPath, '\n');
      }
      return bytes;
    });
    try {
      assert.throws(
        () => auditInstalledConsumer(fixture.options),
        /Declaration fallback (?:owner|evidence|target) changed/u,
        variant,
      );
      assert.equal(mutated, true, variant);
    } finally {
      reader.mock.restore();
    }
  }
});

test('root exports cannot admit unexported subpaths or selected null conditions', t => {
  for (const exports of [
    './index.js',
    { import: null, default: './index.js' },
  ]) {
    const { options, root } = consumerFixture(t);
    const manifest = path.join(
      root,
      'node_modules',
      rendererPackage,
      'package.json',
    );
    writeJson(manifest, {
      ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
      exports,
    });
    write(
      path.join(root, 'dist', 'server.mjs'),
      typeof exports === 'string'
        ? "import '@modern-js/renderer-solid/missing';\n"
        : "import '@modern-js/renderer-solid';\n",
    );
    assert.throws(() => auditInstalledConsumer(options), /No selected export/u);
  }
});

test('exports select the most specific wildcard and require an exact published file', t => {
  const { options, root } = consumerFixture(t);
  const directory = path.join(root, 'node_modules', rendererPackage);
  const manifest = path.join(directory, 'package.json');
  writeJson(manifest, {
    ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
    exports: { '.': './index.js', './*': './index.js', './native/*': null },
  });
  write(
    path.join(root, 'dist', 'server.mjs'),
    "import '@modern-js/renderer-solid/native/hidden';\n",
  );
  assert.throws(() => auditInstalledConsumer(options), /No selected export/u);
  writeJson(manifest, {
    ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
    exports: { '.': './index' },
  });
  write(
    path.join(root, 'dist', 'server.mjs'),
    "import '@modern-js/renderer-solid';\n",
  );
  assert.throws(
    () => auditInstalledConsumer(options),
    /Unresolved entry import/u,
  );
});

test('a development tuple cannot certify a different installed package identity', t => {
  const { options, root } = consumerFixture(t, {
    devDependencies: { 'native-compiler': version },
  });
  installFixture(root, 'native-compiler', { name: 'impostor' });
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...options,
        exactPackages: { ...options.exactPackages, 'native-compiler': version },
      }),
    /identity mismatch/u,
  );
});

test('installed audit rejects workspace links escaping the isolated consumer', t => {
  const { options, root } = consumerFixture(t);
  const outside = ownedDirectory(t);
  installFixture(outside, 'solid-js');
  fs.rmSync(path.join(root, 'node_modules', 'solid-js'), { recursive: true });
  fs.symlinkSync(
    path.join(outside, 'node_modules', 'solid-js'),
    path.join(root, 'node_modules', 'solid-js'),
  );
  assert.throws(
    () => auditInstalledConsumer(options),
    /outside the clean consumer/u,
  );
});

test('React baseline accepts its declared React peer through the same auditor', t => {
  const { options, root } = consumerFixture(t);
  const file = path.join(root, 'node_modules', rendererPackage, 'package.json');
  writeJson(file, {
    ...JSON.parse(fs.readFileSync(file, 'utf8')),
    peerDependencies: { react: version },
  });
  installFixture(root, 'react');
  assert.equal(
    auditInstalledConsumer({ ...options, renderer: 'react' }).closure.length,
    2,
  );
});

test('React baseline declaration packages do not inherit the native Octane permission', t => {
  const { options, root } = consumerFixture(t);
  const file = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.dependencies['@types/react'] = version;
  writeJson(file, manifest);
  installFixture(root, '@types/react', {
    types: './index.d.ts',
    exports: './index.d.ts',
  });
  write(
    path.join(root, 'src/entry.tsx'),
    "import type { native } from '@types/react';\nexport type Result = typeof native;\n",
  );
  const report = auditInstalledConsumer({ ...options, renderer: 'react' });
  assert.ok(
    report.entryClosure.some(item =>
      item.path.endsWith('@types/react/index.d.ts'),
    ),
  );
  assert.equal(report.nativeTypeInterop, null);
});

test('artifact audit certifies mapped tarballs and empty optional main, and rejects missing targets or changed evidence', async t => {
  const root = ownedDirectory(t);
  const sidecarName = '@bleedingdev/rsbuild-core';
  const sidecarVersion = '2.2.9';
  const sidecarAlias = `npm:${sidecarName}@${sidecarVersion}`;
  const names = ['renderer-solid', 'i18n-utils', 'ultramodern-create', 'types'];
  const aliases = Object.fromEntries(
    names.map(name => [`@modern-js/${name}`, `@bleedingdev/modern-js-${name}`]),
  );
  const packages = names.map(name => {
    const packageDir = path.join(root, 'staged', name);
    writeJson(path.join(packageDir, 'package.json'), {
      name: aliases[`@modern-js/${name}`],
      version,
      publishConfig: { access: 'public' },
      engines: { node: '>=26.10.0' },
      exports:
        name === 'types'
          ? { '.': { types: './index.d.ts', default: './index.d.ts' } }
          : name === 'ultramodern-create'
            ? {
                '.': './index.js',
                './ultramodern-workspace': './index.js',
                './ultramodern-workspace/codesmith': './index.js',
              }
            : { '.': { types: './index.d.ts', import: './index.js' } },
      ...(name === 'types' ? { main: '', types: './index.d.ts' } : {}),
      ...(name === 'renderer-solid'
        ? {
            peerDependencies: {
              '@rsbuild/core': '^2.0.0-0',
              events: '^2.0.0-0',
            },
          }
        : {}),
      ...(name === 'ultramodern-create'
        ? {
            ultramodern: { frameworkVersion: version },
            dependencies: {
              '@modern-js/i18n-utils': `npm:${aliases['@modern-js/i18n-utils']}@${version}`,
              '@rsbuild/core': sidecarAlias,
              events: sidecarAlias,
            },
          }
        : {}),
    });
    if (name !== 'types')
      write(path.join(packageDir, 'index.js'), 'export const native = true;\n');
    write(path.join(packageDir, 'data.txt'), 'immutable candidate content\n');
    write(
      path.join(packageDir, 'index.d.ts'),
      'export declare const native: boolean;\n',
    );
    if (name === 'ultramodern-create')
      for (const file of createTemplateRequiredFiles)
        write(path.join(packageDir, file), 'fixture\n');
    return {
      packageDir: path.relative(repoRoot, packageDir),
      sourceName: `@modern-js/${name}`,
      targetName: aliases[`@modern-js/${name}`],
      version,
    };
  });
  const stagedSidecars = [sidecarName, '@bleedingdev/other-rsbuild-core'].map(
    name => {
      const stagedDir = path.join(root, 'staged', name.split('/')[1]);
      const packageJson = {
        name,
        version: sidecarVersion,
        type: 'module',
        exports: { '.': './index.js' },
      };
      writeJson(path.join(stagedDir, 'package.json'), packageJson);
      write(
        path.join(stagedDir, 'index.js'),
        'export const compiler = true;\n',
      );
      return {
        name,
        version: sidecarVersion,
        root: `sidecars/${name.split('/')[1]}`,
        stagedDir,
        packageJson,
      };
    },
  );
  const sidecarReleaseRoot = path.join(root, 'release');
  fs.mkdirSync(sidecarReleaseRoot, { recursive: true });
  const sidecarManifest = writeSidecarStagingManifest(
    sidecarReleaseRoot,
    stagedSidecars,
    {
      publishBefore: rendererPackage,
    },
  );
  const artifactOptions = {
    aliases,
    command: execFileSync,
    packages,
    source: {
      commit: sourceRevision,
      repository: 'BleedingDev/ultramodern.js',
    },
    tag: 'preview',
    tools: { node: process.version, npm: 'fixture-npm', pnpm: 'fixture-pnpm' },
    version,
    sidecars: sidecarManifest.descriptor,
  };
  createReleaseArtifacts({
    ...artifactOptions,
    outDir: path.join(root, 'release'),
  });
  const manifestPath = path.join(root, 'release', 'manifest.json');
  const report = auditReleaseArtifacts({
    manifestPath,
    expectedSourceRevision: sourceRevision,
  });
  assert.equal(report.artifacts.length, 4);
  assert.equal(report.sourceRevision, sourceRevision);
  assert.deepEqual(report.aliases, aliases);
  assert.equal(report.artifacts[0].engines.node, '>=26.10.0');
  assert.match(report.artifacts[0].integrity, /^sha512-/u);
  assert.match(report.artifacts[0].files[0].sha256, /^[a-f0-9]{64}$/u);
  const typesArtifact = report.artifacts.find(
    item => item.sourceName === '@modern-js/types',
  );
  assert.equal(
    typesArtifact.exportTargets.some(item => item.conditions.includes('main')),
    false,
  );
  assert.equal(
    typesArtifact.files.some(item => /\.[cm]?js$/u.test(item.path)),
    false,
  );
  const consumerRoot = path.join(root, 'consumer');
  writeJson(path.join(consumerRoot, 'package.json'), {
    name: 'candidate-installed-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@modern-js/renderer-solid': `npm:${rendererPackage}@${version}`,
    },
  });
  const candidate = report.artifacts.find(
    item => item.name === rendererPackage,
  );
  const inspection = inspectNpmTarball(fs.readFileSync(candidate.path));
  const installedRoot = path.join(
    consumerRoot,
    'node_modules',
    rendererPackage,
  );
  for (const [file, bytes] of inspection.fileContents)
    write(path.join(installedRoot, file), bytes);
  fs.mkdirSync(path.join(consumerRoot, 'node_modules', '@modern-js'), {
    recursive: true,
  });
  fs.symlinkSync(
    '../@bleedingdev/modern-js-renderer-solid',
    path.join(consumerRoot, 'node_modules', '@modern-js', 'renderer-solid'),
  );
  write(
    path.join(consumerRoot, 'src', 'entry.ts'),
    "import '@modern-js/renderer-solid';\n",
  );
  const consumerOptions = {
    consumerRoot,
    renderer: 'solid',
    exactPackages: { [rendererPackage]: version },
    entryFiles: ['src/entry.ts'],
    releaseArtifacts: report,
  };
  const sidecar = report.sidecars.find(item => item.name === sidecarName);
  const sidecarInspection = inspectNpmTarball(fs.readFileSync(sidecar.path));
  const installedSidecar = path.join(consumerRoot, 'node_modules', sidecarName);
  for (const [file, bytes] of sidecarInspection.fileContents)
    write(path.join(installedSidecar, file), bytes);
  fs.mkdirSync(path.join(consumerRoot, 'node_modules', '@rsbuild'), {
    recursive: true,
  });
  fs.symlinkSync(
    '../@bleedingdev/rsbuild-core',
    path.join(consumerRoot, 'node_modules', '@rsbuild', 'core'),
  );
  fs.symlinkSync(
    '@bleedingdev/rsbuild-core',
    path.join(consumerRoot, 'node_modules', 'events'),
  );
  const workspaceFile = path.join(consumerRoot, 'pnpm-workspace.yaml');
  const workspace = `overrides:\n  '@rsbuild/core': '${sidecarAlias}'\n  events: '${sidecarAlias}'\n`;
  write(workspaceFile, workspace);
  const installedReport = auditInstalledConsumer(consumerOptions);
  assert.equal(installedReport.producerArtifactBindings.length, 1);
  assert.equal(installedReport.producerSidecarBindings.length, 1);
  assert.equal(
    installedReport.producerSidecarBindings[0].artifactSha256,
    sidecar.sha256,
  );
  assert.equal(installedReport.workspaceAliasBindings.length, 2);
  assert.deepEqual(
    installedReport.workspaceAliasBindings.find(
      item => item.name === '@rsbuild/core',
    ),
    {
      name: '@rsbuild/core',
      specifier: sidecarAlias,
      targetName: sidecarName,
      version: sidecarVersion,
      declarations: [
        {
          owner: aliases['@modern-js/ultramodern-create'],
          ownerVersion: version,
          artifactSha256: report.artifacts.find(
            item => item.sourceName === '@modern-js/ultramodern-create',
          ).sha256,
          block: 'dependencies',
        },
      ],
      workspaceFile: 'pnpm-workspace.yaml',
      workspaceSha256: fileSha256(workspaceFile),
    },
  );
  const peerEdge = installedReport.edges.find(
    edge => edge.name === '@rsbuild/core',
  );
  assert.equal(peerEdge.declaredSpecifier, '^2.0.0-0');
  assert.equal(peerEdge.resolvedSpecifier, sidecarAlias);
  assert.equal(peerEdge.installedName, sidecarName);
  const builtinPeerEdge = installedReport.edges.find(
    edge => edge.name === 'events',
  );
  assert.equal(builtinPeerEdge.declaredSpecifier, '^2.0.0-0');
  assert.equal(builtinPeerEdge.installedName, sidecarName);
  assert.equal(builtinPeerEdge.installedPath, peerEdge.installedPath);
  assert.equal(
    report.artifacts.length,
    4,
    'Sidecars do not enter framework cohort inventory',
  );
  assert.equal(
    installedReport.producerArtifactBindings[0].frameworkCohortDigest,
    report.cohortDigest,
  );
  for (const invalidWorkspace of [
    'overrides: {}\n',
    `overrides:\n  '@rsbuild/core': 'npm:@bleedingdev/other-rsbuild-core@${sidecarVersion}'\n`,
    `overrides:\n  '@rsbuild/core': 'npm:${sidecarName}@2.2.8'\n`,
    `overrides:\n  '@rsbuild/core': 'npm:${sidecarName}@^${sidecarVersion}'\n`,
    `${workspace}  'ordinary-peer-owner>@rsbuild/core': '${sidecarAlias}'\n`,
    `${workspace}  '@rsbuild/core': '${sidecarAlias}'\n`,
  ]) {
    write(workspaceFile, invalidWorkspace);
    assert.throws(
      () => auditInstalledConsumer(consumerOptions),
      /identity mismatch|Workspace alias|Invalid owning workspace/u,
    );
  }
  write(workspaceFile, workspace);
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...consumerOptions,
        releaseArtifacts: undefined,
      }),
    /no authenticated archive declaration/u,
  );
  for (const changed of [
    { name: '@bleedingdev/other-rsbuild-core' },
    { version: '2.2.8' },
  ]) {
    writeJson(path.join(installedSidecar, 'package.json'), {
      ...sidecarInspection.packageJson,
      ...changed,
    });
    assert.throws(
      () => auditInstalledConsumer(consumerOptions),
      /identity mismatch|version .* differs/u,
    );
  }
  write(
    path.join(installedSidecar, 'package.json'),
    sidecarInspection.fileContents.get('package.json'),
  );
  write(
    path.join(installedSidecar, 'index.js'),
    'export const compiler = false;\n',
  );
  assert.throws(
    () => auditInstalledConsumer(consumerOptions),
    /sidecar package .* differs from candidate artifact bytes/u,
  );
  write(
    path.join(installedSidecar, 'index.js'),
    sidecarInspection.fileContents.get('index.js'),
  );
  const sidecarArchive = fs.readFileSync(sidecar.path);
  fs.appendFileSync(sidecar.path, '\n');
  assert.throws(
    () => auditInstalledConsumer(consumerOptions),
    /sidecar tarball size mismatch/u,
  );
  write(sidecar.path, sidecarArchive);
  const appManifestFile = path.join(consumerRoot, 'package.json');
  const appManifest = JSON.parse(fs.readFileSync(appManifestFile, 'utf8'));
  writeJson(appManifestFile, {
    ...appManifest,
    dependencies: {
      ...appManifest.dependencies,
      'ordinary-peer-owner': '1.0.0',
    },
  });
  const ordinaryOwner = installFixture(consumerRoot, 'ordinary-peer-owner', {
    version: '1.0.0',
    peerDependencies: { '@rsbuild/core': '2.2.8' },
  });
  assert.throws(
    () => auditInstalledConsumer(consumerOptions),
    /differs from declared 2\.2\.8/u,
  );
  writeJson(appManifestFile, appManifest);
  fs.rmSync(ordinaryOwner, { recursive: true });

  const conflictingRoot = path.join(root, 'conflicting-release');
  fs.mkdirSync(conflictingRoot);
  const conflictingSidecars = writeSidecarStagingManifest(
    conflictingRoot,
    stagedSidecars,
    { publishBefore: rendererPackage },
  );
  const stagedRendererManifest = path.join(
    root,
    'staged',
    'renderer-solid',
    'package.json',
  );
  const rendererManifest = JSON.parse(
    fs.readFileSync(stagedRendererManifest, 'utf8'),
  );
  writeJson(stagedRendererManifest, {
    ...rendererManifest,
    optionalDependencies: {
      '@rsbuild/core': `npm:@bleedingdev/other-rsbuild-core@${sidecarVersion}`,
    },
  });
  createReleaseArtifacts({
    ...artifactOptions,
    outDir: conflictingRoot,
    sidecars: conflictingSidecars.descriptor,
  });
  writeJson(stagedRendererManifest, rendererManifest);
  const conflictingReport = auditReleaseArtifacts({
    manifestPath: path.join(conflictingRoot, 'manifest.json'),
  });
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...consumerOptions,
        releaseArtifacts: conflictingReport,
      }),
    /Conflicting authenticated archive alias @rsbuild\/core/u,
  );
  const binding =
    auditInstalledConsumer(consumerOptions).producerArtifactBindings[0];
  assert.equal(binding.artifactSha256, candidate.sha256);
  assert.equal(binding.sourceRevision, sourceRevision);
  assert.equal(binding.manifestSha256, report.manifestSha256);
  assert.equal(binding.frameworkCohortDigest, report.cohortDigest);
  assert.equal(binding.files.length, candidate.files.length);
  assert.match(binding.fileGraphSha256, /^[a-f0-9]{64}$/u);
  for (const file of ['index.js', 'index.d.ts', 'package.json']) {
    write(
      path.join(installedRoot, file),
      Buffer.concat([inspection.fileContents.get(file), Buffer.from('\n')]),
    );
    assert.throws(
      () => auditInstalledConsumer(consumerOptions),
      /differs from candidate artifact bytes/u,
    );
    write(path.join(installedRoot, file), inspection.fileContents.get(file));
  }
  write(
    path.join(installedRoot, 'injected.mjs'),
    'export const injected = true;\n',
  );
  assert.throws(
    () => auditInstalledConsumer(consumerOptions),
    /injected file injected.mjs/u,
  );
  fs.rmSync(path.join(installedRoot, 'injected.mjs'));
  fs.rmSync(path.join(installedRoot, 'data.txt'));
  assert.throws(
    () => auditInstalledConsumer(consumerOptions),
    /missing candidate artifact files: data.txt/u,
  );
  write(
    path.join(installedRoot, 'data.txt'),
    inspection.fileContents.get('data.txt'),
  );
  fs.symlinkSync(
    path.join(installedRoot, 'index.js'),
    path.join(installedRoot, 'injected-link.js'),
  );
  assert.throws(
    () => auditInstalledConsumer(consumerOptions),
    /non-regular packed file injected-link.js/u,
  );
  fs.rmSync(path.join(installedRoot, 'injected-link.js'));
  write(path.join(installedRoot, 'node_modules'), 'injected file\n');
  assert.throws(
    () => auditInstalledConsumer(consumerOptions),
    /injected file node_modules/u,
  );
  fs.rmSync(path.join(installedRoot, 'node_modules'));
  fs.symlinkSync(
    path.join(installedRoot, 'index.js'),
    path.join(installedRoot, 'node_modules'),
  );
  assert.throws(
    () => auditInstalledConsumer(consumerOptions),
    /non-regular packed file node_modules/u,
  );
  fs.rmSync(path.join(installedRoot, 'node_modules'));
  assert.throws(
    () =>
      auditInstalledConsumer({
        ...consumerOptions,
        releaseArtifacts: { ...report, cohortDigest: 'b'.repeat(64) },
      }),
    /cohortDigest differs from its actual manifest/u,
  );
  assert.throws(
    () =>
      auditReleaseArtifacts({
        manifestPath,
        expectedSourceRevision: 'b'.repeat(40),
      }),
    /source revision.*differs/u,
  );
  const artifact = report.artifacts[0].path;
  const bytes = fs.readFileSync(artifact);
  bytes[bytes.length - 1] ^= 1;
  fs.writeFileSync(artifact, bytes);
  assert.throws(
    () => auditReleaseArtifacts({ manifestPath }),
    /tarball SHA-256 mismatch/u,
  );
  const typesManifestPath = path.join(root, 'staged', 'types', 'package.json');
  const typesManifest = JSON.parse(fs.readFileSync(typesManifestPath, 'utf8'));
  for (const [name, invalid, diagnostic] of [
    [
      'missing-main',
      { main: './missing.js' },
      /export main is missing \.\/missing\.js/u,
    ],
    ['empty-export', { exports: { '.': '' } }, /unsafe export target/u],
  ]) {
    writeJson(typesManifestPath, { ...typesManifest, ...invalid });
    const outDir = path.join(root, name);
    fs.mkdirSync(outDir);
    const invalidSidecars = writeSidecarStagingManifest(
      outDir,
      stagedSidecars,
      { publishBefore: rendererPackage },
    );
    createReleaseArtifacts({
      ...artifactOptions,
      outDir,
      sidecars: invalidSidecars.descriptor,
    });
    assert.throws(
      () =>
        auditReleaseArtifacts({
          manifestPath: path.join(outDir, 'manifest.json'),
        }),
      diagnostic,
    );
  }
});

test('tested profile tuple projects the installed renderer profile onto the consumer tuple', () => {
  const profile = {
    renderer: 'react',
    dependencies: { react: '19.3.0', 'react-dom': '19.3.0', jiti: '2.7.0' },
  };
  assert.deepEqual(
    testedProfileTuple(profile, { react: '19.3.0', 'react-dom': '19.3.0' }),
    { renderer: 'react', packages: { react: '19.3.0', 'react-dom': '19.3.0' } },
  );
  assert.throws(
    () => testedProfileTuple(profile, { vue: '3.0.0' }),
    /shares no exact package/u,
  );
});
