import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createTemplateRequiredFiles,
  repoRoot,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/constants.mjs';
import {
  createReleaseArtifacts,
  inspectNpmTarball,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { auditInstalledConsumer, auditReleaseArtifacts } from './artifacts.mjs';

const sourceRevision = 'a'.repeat(40);
const version = '3.8.3-ultramodern.18';
const rendererPackage = '@bleedingdev/modern-js-renderer-solid';
const nativeVersion = '2.0.0-rc.13';
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
      '2ba3502bc1d09a03d40af31bc6c09eedf6984781cb29c2df9788248bacb99cae',
    );
    const corpusPath = path.join(declarationFixtureRoot, 'corpus.json');
    assert.equal(
      fileSha256(corpusPath),
      'ba421e5caf0fdc99caa8290aee5fb91bd7ccabc6ad425c9876e4cfd6afc3d63b',
    );
    const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
    assert.equal(corpus.authoritySha256, fileSha256(typeInteropEvidencePath));
    assert.equal(corpus.nativeSource.version, octaneVersion);
    assert.equal(corpus.reactTypes.version, reactTypesVersion);
    assert.equal(
      corpus.nativeSource.archiveSha256,
      typeInteropEvidence.nativeSourcePackage.sha256,
    );
    assert.equal(corpus.files.length, 55);
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
    engines: { node: '>=26.7.0' },
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
  assert.equal(report.nativeTypeInterop.files.length, 6);
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
  assert.equal(report.closure[0].engines.node, '>=26.7.0');
  assert.equal(report.closure[0].peerDependencies['solid-js'], nativeVersion);
  assert.equal(report.entryClosure.length, 4);
  assert.match(report.closure[0].manifestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(report.exportConditionExecution, 'required-separate-probe');
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

test('artifact audit certifies actual mapped tarballs and fails changed bytes or source', async t => {
  const root = ownedDirectory(t);
  const names = ['renderer-solid', 'i18n-utils', 'ultramodern-create'];
  const aliases = Object.fromEntries(
    names.map(name => [`@modern-js/${name}`, `@bleedingdev/modern-js-${name}`]),
  );
  const packages = names.map(name => {
    const packageDir = path.join(root, 'staged', name);
    writeJson(path.join(packageDir, 'package.json'), {
      name: aliases[`@modern-js/${name}`],
      version,
      publishConfig: { access: 'public' },
      engines: { node: '>=26.7.0' },
      exports:
        name === 'ultramodern-create'
          ? {
              '.': './index.js',
              './ultramodern-workspace': './index.js',
              './ultramodern-workspace/codesmith': './index.js',
            }
          : { '.': { types: './index.d.ts', import: './index.js' } },
      ...(name === 'ultramodern-create'
        ? {
            ultramodern: { frameworkVersion: version },
            dependencies: {
              '@modern-js/i18n-utils': `npm:${aliases['@modern-js/i18n-utils']}@${version}`,
            },
          }
        : {}),
    });
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
  createReleaseArtifacts({
    aliases,
    command: execFileSync,
    outDir: path.join(root, 'release'),
    packages,
    source: {
      commit: sourceRevision,
      repository: 'BleedingDev/ultramodern.js',
    },
    tag: 'preview',
    tools: { node: process.version, npm: 'fixture-npm', pnpm: 'fixture-pnpm' },
    version,
  });
  const manifestPath = path.join(root, 'release', 'manifest.json');
  const report = auditReleaseArtifacts({
    manifestPath,
    expectedSourceRevision: sourceRevision,
  });
  assert.equal(report.artifacts.length, 3);
  assert.equal(report.sourceRevision, sourceRevision);
  assert.deepEqual(report.aliases, aliases);
  assert.equal(report.artifacts[0].engines.node, '>=26.7.0');
  assert.match(report.artifacts[0].integrity, /^sha512-/u);
  assert.match(report.artifacts[0].files[0].sha256, /^[a-f0-9]{64}$/u);
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
});
