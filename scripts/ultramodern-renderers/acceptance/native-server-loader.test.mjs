// Controlled unit cohort only: these stub owner APIs do not qualify a renderer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from '@babel/core';
import transformModulesCommonjs from '@babel/plugin-transform-modules-commonjs';
import {
  createTemplateRequiredFiles,
  repoRoot,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/constants.mjs';
import {
  createReleaseArtifacts,
  inspectNpmTarball,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { auditInstalledConsumer, auditReleaseArtifacts } from './artifacts.mjs';

const version = '3.8.3-ultramodern.18';
const sourceRevision = 'a'.repeat(40);
const sourceNames = [
  'ultramodern-app-tools',
  'renderer-core',
  'utils',
  'i18n-utils',
  'ultramodern-create',
];
const aliases = Object.fromEntries(
  sourceNames.map(name => [
    `@modern-js/${name}`,
    `@bleedingdev/modern-js-${name}`,
  ]),
);
const ultra = aliases['@modern-js/ultramodern-app-tools'];
const utils = aliases['@modern-js/utils'];
const core = aliases['@modern-js/renderer-core'];
const builderRequire = createRequire(
  path.join(repoRoot, 'packages/cli/builder/package.json'),
);
const { transformSync: transformTypeScript } = builderRequire('@swc/core');

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function ownedDirectory(t) {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'native-server-loader-test-')),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function loaderSource(format = 'cjs', mutation) {
  const imports =
    format === 'cjs'
      ? [
          `const Path = require('node:path');`,
          `const Url = require('node:url');`,
          `const Core = require('${core}');`,
          `const Utils = require('${utils}');`,
        ]
      : format === 'esm-named'
        ? [
            `import Path from 'node:path';`,
            `import { pathToFileURL } from 'node:url';`,
            `import { assertRendererIdentity } from '${core}';`,
            `import { SERVER_BUNDLE_DIRECTORY } from '${utils}';`,
          ]
        : [
            `import * as Path from 'node:path';`,
            `import * as Url from 'node:url';`,
            `import * as Core from '${core}';`,
            `import * as Utils from '${utils}';`,
          ];
  const one = `    if (files.length !== 1) throw new Error('Exactly one emitted entry is required');`;
  const canonical = `    if (Path.relative(api.getAppContext().distDirectory, Path.join(server.compilation.outputOptions.path, files[0])).split(Path.sep).join('/') !== \`\${Utils.SERVER_BUNDLE_DIRECTORY}/\${entryName}.js\`) throw new Error('Canonical native server route required');`;
  let source = [
    ...imports,
    `${format === 'cjs' ? 'exports.load = ' : 'export const load = '}async function(api, server, buildIdentities) {`,
    '  for (const [entryName, identity] of Object.entries(buildIdentities.identities)) {',
    '    const chunk = server.compilation.entrypoints.get(entryName)?.getEntrypointChunk();',
    '    const files = chunk ? [...chunk.files].filter(file => /\\.[cm]?js$/u.test(file)) : [];',
    one,
    canonical,
    `    const module = await import(\`\${Url.pathToFileURL(Path.join(server.compilation.outputOptions.path, files[0])).href}?build=\${identity.buildId}\`);`,
    '    const exported = module.rendererIdentity ? module : module.default;',
    '    Core.assertRendererIdentity(exported?.rendererIdentity, identity);',
    "    if (typeof exported?.nativeRequestHandler !== 'function' || typeof exported?.nativeCSRRequestHandler !== 'function') throw new Error('Native transport handlers required');",
    '  }',
    '};',
    '',
  ].join('\n');
  if (format === 'esm-named') {
    source = source
      .replace('Url.pathToFileURL', 'pathToFileURL')
      .replace('Core.assertRendererIdentity', 'assertRendererIdentity')
      .replace('Utils.SERVER_BUNDLE_DIRECTORY', 'SERVER_BUNDLE_DIRECTORY');
  }
  const swaps = {
    'removed-count': [one, ''],
    'removed-path': [canonical, ''],
    reordered: [`${one}\n${canonical}`, `${canonical}\n${one}`],
    'wrong-files-binding': ['files[0])).href', 'otherFiles[0])).href'],
    'wrong-files-origin': [
      '    const files = chunk ? [...chunk.files].filter(file => /\\.[cm]?js$/u.test(file)) : [];',
      "    let reads = 0;\n    const files = { length: 1, get 0() { return reads++ === 0 ? 'bundles/' + entryName + '.js' : '../../forged.js'; } };",
    ],
    'forged-path-wrapper': [
      "const Path = require('node:path');",
      "const Path = { n: () => ({ join: () => '/forged.js', relative: () => 'bundles/main.js', sep: '/' }) }.n(require('node:path'));",
    ],
    'wrong-identity-binding': [
      `?build=\${identity.buildId}`,
      `?build=\${otherIdentity.buildId}`,
    ],
    'shadowed-path': [
      'async function(api, server, buildIdentities)',
      'async function(api, server, buildIdentities, Path)',
    ],
    'shadowed-url': [
      'async function(api, server, buildIdentities)',
      'async function(api, server, buildIdentities, Url)',
    ],
    'shadowed-core': [
      'async function(api, server, buildIdentities)',
      'async function(api, server, buildIdentities, Core)',
    ],
    'shadowed-utils': [
      'async function(api, server, buildIdentities)',
      'async function(api, server, buildIdentities, Utils)',
    ],
    'missing-identity-assert': [
      '    Core.assertRendererIdentity(exported?.rendererIdentity, identity);',
      '',
    ],
    'wrong-handler': ['nativeCSRRequestHandler', 'otherHandler'],
  };
  if (mutation && swaps[mutation]) {
    const [before, after] = swaps[mutation];
    assert.ok(source.includes(before), mutation);
    source = source.replace(before, after);
  }
  if (mutation === 'extra-computed')
    source += 'async function arbitrary(target) { return import(target); }\n';
  return source;
}

function controlledOwnerApi() {
  return `// Unit fixture validator only, never native qualification evidence.
exports.resolveRendererProfile = renderer => ({ renderer, fixture: 'controlled-unit-cohort', dependencies: { '${ultra}': '${version}' } });
exports.RENDERER_BUILD_MANIFEST_FILE = 'renderer-build.json';
exports.validateRendererBuildManifest = (value, profile) => {
  if (value.schema !== 'ultramodern-renderer-build' || value.version !== 1 || JSON.stringify(value.profile) !== JSON.stringify(profile)) throw new Error('Unit owner manifest profile mismatch');
  for (const key of ['buildMarker', 'inputDigest', 'profileDigest', 'compilerDigest', 'frameworkCohortDigest']) {
    if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(value[key])) throw new Error('Unit owner manifest requires valid ' + key);
  }
  if (!value.identities || !Object.keys(value.identities).length) throw new Error('Unit owner manifest identities missing');
  for (const [entryName, identity] of Object.entries(value.identities)) {
    if (identity.renderer !== profile.renderer || identity.entryName !== entryName || identity.buildId !== value.buildMarker) throw new Error('Unit owner identity mismatch');
  }
  return value;
};\n`;
}

function developmentLoaderSource(format, mutation, packageAliases) {
  const filename = path.join(
    repoRoot,
    'packages/solutions/ultramodern-app-tools/src/native-composition/native-development.ts',
  );
  let source = fs.readFileSync(filename, 'utf8');
  const countGuard = `      if (files.length !== 1)
        throw new Error(
          \`Native development entry \${entryName} requires one actual emitted server module\`,
        );`;
  const mutations = {
    'removed-count': [countGuard, ''],
    'unsafe-asset-helper': [
      "part => !part || part === '.' || part === '..'",
      "part => part === '.'",
    ],
    'wrong-loop': [
      'Object.entries(session.identities)',
      'Object.entries(unbound.identities)',
    ],
    'wrong-handler': [
      "typeof exported?.nativeCSRRequestHandler !== 'function'",
      "typeof exported?.otherHandler !== 'function'",
    ],
    'checkpoint-write-before-loop': [
      '    for (const [entryName, identity] of Object.entries(session.identities)) {',
      "    await fs.writeFile(path.join(serverRoot, 'bundles/main.js'), 'forged checkpoint');\n    for (const [entryName, identity] of Object.entries(session.identities)) {",
    ],
  };
  if (mutation && mutations[mutation]) {
    const [before, after] = mutations[mutation];
    assert.ok(source.includes(before), mutation);
    source = source.replace(before, after);
  }
  for (const [name, target] of Object.entries(packageAliases))
    source = source.replaceAll(name, target);
  if (mutation === 'extra-computed')
    source += '\nasync function arbitrary(file) { return import(file); }\n';
  // The installed builder compiler transforms the real owning TypeScript guard.
  // This source unit fixture does not qualify a native application compilation.
  const javascript = transformTypeScript(source, {
    filename,
    jsc: { parser: { syntax: 'typescript' }, target: 'esnext' },
    module: { type: 'es6' },
  }).code;
  return format === 'cjs'
    ? transformSync(javascript, {
        filename: 'native-development.js',
        babelrc: false,
        configFile: false,
        plugins: [[transformModulesCommonjs, { importInterop: 'node' }]],
      }).code
    : javascript;
}

function controlledDevelopmentApi() {
  return `
exports.RENDERER_DEVELOPMENT_DIRECTORY = '.ultramodern-dev';
exports.assertRendererBuildInputsUnchanged = () => undefined;
exports.validateRendererDevelopmentBuildManifest = (value, profile) => {
  exports.validateRendererBuildManifest(value, profile);
  const fields = value.devCompilation;
  if (!fields || Object.keys(fields).sort().join(',') !== 'compilationHashes,generation,sourceInputDigest') throw new Error('Unit development compilation fields invalid');
  if (!Number.isSafeInteger(fields.generation) || fields.generation < 1 || !/^[a-f0-9]{64}$/u.test(fields.sourceInputDigest)) throw new Error('Unit development generation or source invalid');
  if (!fields.compilationHashes || !Object.keys(fields.compilationHashes).length || Object.entries(fields.compilationHashes).some(([name, hash]) => name !== name.trim() || !name || typeof hash !== 'string' || !/^[a-f0-9]{1,64}$/u.test(hash))) throw new Error('Unit development compiler hashes invalid');
  if (value.cacheAllowed !== false || value.promotable !== false) throw new Error('Unit development cannot be cached or promoted');
  return value;
};\n`;
}

function cohortFixture(
  t,
  {
    renderer = 'solid',
    format = 'cjs',
    mutation,
    wrongFile = false,
    loaderKind = 'production',
  } = {},
) {
  const root = ownedDirectory(t);
  const development = loaderKind === 'development';
  const cohortNames = development
    ? [...sourceNames, 'renderer-solid', 'renderer-octane']
    : sourceNames;
  const packageAliases = development
    ? {
        ...aliases,
        '@modern-js/renderer-solid': '@bleedingdev/modern-js-renderer-solid',
        '@modern-js/renderer-octane': '@bleedingdev/modern-js-renderer-octane',
      }
    : aliases;
  const moduleName = development
    ? 'native-development'
    : 'native-infrastructure';
  const canonicalFile =
    format === 'cjs'
      ? `dist/cjs/native-composition/${moduleName}.js`
      : `dist/esm-node/native-composition/${moduleName}.mjs`;
  const loaderFile = wrongFile
    ? canonicalFile.replace(moduleName, 'other-infrastructure')
    : canonicalFile;
  const source = development
    ? developmentLoaderSource(format, mutation, packageAliases)
    : loaderSource(format, mutation);
  const packages = cohortNames.map(name => {
    const packageDir = path.join(root, 'staged', name);
    const targetName = packageAliases[`@modern-js/${name}`];
    const manifest = {
      name: targetName,
      version,
      publishConfig: { access: 'public' },
      engines: { node: '>=26.7.0' },
      main: './index.cjs',
      exports: { '.': './index.cjs' },
    };
    let contents = 'exports.fixture = true;\n';
    if (name === 'ultramodern-app-tools') {
      contents = controlledOwnerApi();
      if (development) {
        contents += controlledDevelopmentApi();
        write(
          path.join(
            packageDir,
            path.dirname(loaderFile),
            'native-build-manifest.js',
          ),
          [
            "const owner = require('../../../index.cjs');",
            ...[
              'assertRendererBuildInputsUnchanged',
              'RENDERER_BUILD_MANIFEST_FILE',
              'RENDERER_DEVELOPMENT_DIRECTORY',
              'validateRendererDevelopmentBuildManifest',
            ].map(name => `exports.${name} = owner.${name};`),
            '',
          ].join('\n'),
        );
      }
      manifest.exports['./native-unit-loader'] = `./${loaderFile}`;
      manifest.dependencies = { [core]: version, [utils]: version };
      write(path.join(packageDir, loaderFile), source);
    } else if (name === 'utils') {
      contents = "exports.SERVER_BUNDLE_DIRECTORY = 'bundles';\n";
      if (development) {
        manifest.exports['./mime-types'] = './mime-types.cjs';
        write(
          path.join(packageDir, 'mime-types.cjs'),
          "// Controlled unit MIME API only; no native provider qualification.\nexports.contentType = () => 'application/octet-stream';\n",
        );
      }
    } else if (name === 'renderer-core') {
      contents =
        'exports.assertRendererIdentity = (actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Unit renderer identity mismatch"); };\n';
      if (development) {
        manifest.exports['./identity'] = './index.cjs';
        manifest.exports['./server'] = './index.cjs';
        contents +=
          'exports.validateNativeClientAssetManifest = value => value;\n';
      }
    } else if (name === 'renderer-solid' || name === 'renderer-octane') {
      manifest.exports['./manifest'] = './index.cjs';
      contents =
        'exports.validateSolidModuleManifest = () => undefined; exports.validateOctaneModuleManifest = () => undefined;\n';
    } else if (name === 'ultramodern-create') {
      manifest.exports['./ultramodern-workspace'] = './index.cjs';
      manifest.exports['./ultramodern-workspace/codesmith'] = './index.cjs';
      manifest.ultramodern = { frameworkVersion: version };
      manifest.dependencies = {
        '@modern-js/i18n-utils': `npm:${aliases['@modern-js/i18n-utils']}@${version}`,
      };
      for (const file of createTemplateRequiredFiles)
        write(path.join(packageDir, file), 'controlled unit fixture\n');
    }
    write(path.join(packageDir, 'index.cjs'), contents);
    writeJson(path.join(packageDir, 'package.json'), manifest);
    return {
      packageDir: path.relative(repoRoot, packageDir),
      sourceName: `@modern-js/${name}`,
      targetName,
      version,
    };
  });
  createReleaseArtifacts({
    aliases: packageAliases,
    command: execFileSync,
    outDir: path.join(root, 'release'),
    packages,
    source: {
      commit: sourceRevision,
      repository: 'BleedingDev/ultramodern.js',
    },
    tag: 'preview',
    tools: { node: process.version, npm: 'unit-npm', pnpm: 'unit-pnpm' },
    version,
  });
  const producer = auditReleaseArtifacts({
    manifestPath: path.join(root, 'release', 'manifest.json'),
    expectedSourceRevision: sourceRevision,
  });
  const consumerRoot = path.join(root, 'consumer');
  writeJson(path.join(consumerRoot, 'package.json'), {
    name: 'controlled-native-loader-consumer',
    private: true,
    type: 'module',
    dependencies: { [ultra]: version },
  });
  for (const artifact of producer.artifacts) {
    const installed = path.join(consumerRoot, 'node_modules', artifact.name);
    for (const [file, bytes] of inspectNpmTarball(
      fs.readFileSync(artifact.path),
    ).fileContents)
      write(path.join(installed, file), bytes);
  }
  const identity = {
    renderer,
    appId: 'controlled-unit-app',
    entryName: 'main',
    protocolVersion: 1,
    buildId: 'b'.repeat(64),
  };
  const build = {
    schema: 'ultramodern-renderer-build',
    version: 1,
    profile: {
      renderer,
      fixture: 'controlled-unit-cohort',
      dependencies: { [ultra]: version },
    },
    buildMarker: identity.buildId,
    sourceRevision,
    inputDigest: 'c'.repeat(64),
    profileDigest: 'd'.repeat(64),
    compilerDigest: 'e'.repeat(64),
    frameworkCohortDigest: producer.cohortDigest,
    cacheAllowed: false,
    promotable: false,
    identities: { main: identity },
    routerBindings: { main: [] },
  };
  const manifestFile = path.join(consumerRoot, 'dist/renderer-build.json');
  const developmentManifestFile = path.join(
    consumerRoot,
    'dist/.ultramodern-dev/renderer-build.json',
  );
  const bundleFile = path.join(consumerRoot, 'dist/bundles/main.js');
  writeJson(manifestFile, build);
  if (development)
    writeJson(developmentManifestFile, {
      ...build,
      devCompilation: {
        compilationHashes: { client: '1'.repeat(32), server: '2'.repeat(32) },
        generation: 1,
        sourceInputDigest: 'c'.repeat(64),
      },
    });
  write(
    bundleFile,
    `export const rendererIdentity = ${JSON.stringify(identity)};\nexport const nativeRequestHandler = () => undefined;\nexport const nativeCSRRequestHandler = () => undefined;\n`,
  );
  write(
    path.join(consumerRoot, 'entry.mjs'),
    `import '${ultra}/native-unit-loader';\n`,
  );
  return {
    root,
    consumerRoot,
    producer,
    source,
    loaderFile,
    installedLoader: path.join(consumerRoot, 'node_modules', ultra, loaderFile),
    manifestFile,
    developmentManifestFile,
    bundleFile,
    build,
    identity,
    options: {
      consumerRoot,
      renderer,
      exactPackages: { [ultra]: version },
      entryFiles: ['entry.mjs'],
      releaseArtifacts: producer,
      ...(renderer === 'react'
        ? {}
        : {
            rendererBuildManifestPath: 'dist/renderer-build.json',
            ...(development
              ? {
                  rendererDevelopmentManifestPath:
                    'dist/.ultramodern-dev/renderer-build.json',
                }
              : {}),
          }),
    },
  };
}

// Controlled grammar copied from the current Rspack export-table wiring.
// These bytes are parsed and hashed; this test never executes the module.
for (const format of ['cjs', 'esm']) {
  for (const renderer of ['react', 'solid', 'octane']) {
    test(`development source guard ${format} authenticates the ${renderer} controlled cohort`, t => {
      const fixture = cohortFixture(t, {
        format,
        renderer,
        loaderKind: 'development',
      });
      if (renderer === 'react')
        fs.rmSync(path.join(fixture.consumerRoot, 'dist'), { recursive: true });
      else
        write(
          path.join(
            fixture.consumerRoot,
            'dist/.ultramodern-dev/compilations/unselected-session/1-1-deadbeef/server/bundles/main.js',
          ),
          "throw new Error('Unselected unit checkpoint must never execute');\nimport 'react';\n",
        );
      const report = auditInstalledConsumer(fixture.options);
      assert.ok(
        report.producerArtifactBindings.some(binding => binding.name === ultra),
      );
      const guard = report.ownedComputedServerLoaders.find(binding =>
        binding.path.endsWith(fixture.loaderFile),
      );
      assert.ok(
        guard,
        'Actual candidate development module must have a source guard proof',
      );
      assert.equal(
        guard.checkpointRuntimeAuthority,
        'owning-native-development-provider-and-browser-gates',
      );
      if (renderer !== 'react') {
        const production = report.entryClosure.find(
          entry => entry.path === 'dist/bundles/main.js',
        );
        assert.ok(
          production,
          'Production compiled closure proof remains mandatory',
        );
        assert.equal(
          production.sha256,
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(fixture.bundleFile))
            .digest('hex'),
        );
      }
      assert.ok(
        !report.entryClosure.some(entry =>
          entry.path.includes('/compilations/'),
        ),
        'Source guard evidence must not invent a checkpoint target scan',
      );
    });
  }
}

for (const mutation of [
  'removed-count',
  'unsafe-asset-helper',
  'wrong-loop',
  'wrong-handler',
  'checkpoint-write-before-loop',
  'extra-computed',
]) {
  test(`development source guard rejects candidate-owned ${mutation}`, t => {
    const fixture = cohortFixture(t, { loaderKind: 'development', mutation });
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      /Unverifiable computed module import/u,
    );
  });
}

test('development source guard authenticates owner bytes and rejects authored or noncohort copies', t => {
  const fixture = cohortFixture(t, { loaderKind: 'development' });
  assert.throws(() =>
    auditInstalledConsumer({ ...fixture.options, releaseArtifacts: undefined }),
  );
  fs.appendFileSync(
    fixture.installedLoader,
    '\n// changed installed development bytes\n',
  );
  assert.throws(() => auditInstalledConsumer(fixture.options));
  const wrong = cohortFixture(t, {
    loaderKind: 'development',
    wrongFile: true,
  });
  assert.throws(() => auditInstalledConsumer(wrong.options));
  const authored = cohortFixture(t, { loaderKind: 'development' });
  write(
    path.join(authored.consumerRoot, 'authored-development.js'),
    authored.source,
  );
  write(
    path.join(authored.consumerRoot, 'native-build-manifest.js'),
    `module.exports = require('${ultra}');\n`,
  );
  authored.options.entryFiles.push('authored-development.js');
  assert.throws(
    () => auditInstalledConsumer(authored.options),
    /Unverifiable computed module import/u,
  );
  const noncohort = cohortFixture(t, { loaderKind: 'development' });
  const unrelated = path.join(
    noncohort.consumerRoot,
    'node_modules/unit-only-development-owner',
  );
  writeJson(path.join(unrelated, 'package.json'), {
    name: 'unit-only-development-owner',
    version: '1.0.0',
    main: noncohort.loaderFile,
  });
  write(path.join(unrelated, noncohort.loaderFile), noncohort.source);
  write(
    path.join(unrelated, 'index.cjs'),
    controlledOwnerApi() + controlledDevelopmentApi(),
  );
  write(
    path.join(
      unrelated,
      path.dirname(noncohort.loaderFile),
      'native-build-manifest.js',
    ),
    fs.readFileSync(
      path.join(
        path.dirname(noncohort.installedLoader),
        'native-build-manifest.js',
      ),
    ),
  );
  write(
    path.join(noncohort.consumerRoot, 'unrelated-entry.js'),
    "import 'unit-only-development-owner';\n",
  );
  noncohort.options.entryFiles.push('unrelated-entry.js');
  assert.throws(
    () => auditInstalledConsumer(noncohort.options),
    /Unverifiable computed module import/u,
  );
});

test('development source guard requires canonical validated production and development manifests', t => {
  for (const injection of [
    'missing-development',
    'wrong-development-path',
    'invalid-development-fields',
    'missing-production',
    'changed-production-identity',
  ]) {
    const fixture = cohortFixture(t, { loaderKind: 'development' });
    if (injection === 'missing-development')
      fs.rmSync(fixture.developmentManifestFile);
    else if (injection === 'wrong-development-path') {
      const wrong = path.join(
        fixture.consumerRoot,
        'dist/other/renderer-build.json',
      );
      write(wrong, fs.readFileSync(fixture.developmentManifestFile));
      fixture.options.rendererDevelopmentManifestPath =
        'dist/other/renderer-build.json';
    } else if (injection === 'invalid-development-fields') {
      const metadata = JSON.parse(
        fs.readFileSync(fixture.developmentManifestFile),
      );
      metadata.devCompilation.extraAuthority = 'forged';
      writeJson(fixture.developmentManifestFile, metadata);
    } else if (injection === 'missing-production')
      fs.rmSync(fixture.manifestFile);
    else
      write(
        fixture.bundleFile,
        `export const rendererIdentity = ${JSON.stringify({ ...fixture.identity, buildId: 'f'.repeat(64) })};\nexport const nativeRequestHandler = () => undefined;\nexport const nativeCSRRequestHandler = () => undefined;\n`,
      );
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      undefined,
      injection,
    );
  }
});

function nativeServerTargetExportSource(identity, bridge, mutation) {
  const wrongIdentity = { ...identity, buildId: 'f'.repeat(64) };
  const exportedIdentity =
    mutation === 'decoy-correct-literal' ? wrongIdentity : identity;
  const getterBinding =
    mutation === 'wrong-exported-binding'
      ? 'wrongIdentity'
      : 'rendererIdentity';
  return [
    '"use strict";',
    'var __webpack_require__ = {};',
    '(() => {',
    '  __webpack_require__.d = (exports1, getters, values) => {',
    '    var define = (defs, kind) => {',
    '      for (var key in defs) if (__webpack_require__.o(defs, key) && !__webpack_require__.o(exports1, key)) Object.defineProperty(exports1, key, { enumerable: true, [kind]: defs[key] });',
    '    };',
    '    define(getters, "get");',
    '    define(values, "value");',
    '  };',
    '})();',
    '(() => { __webpack_require__.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop); })();',
    'var __webpack_exports__ = {};',
    `const rendererIdentity = Object.freeze(${JSON.stringify(exportedIdentity)});`,
    `const wrongIdentity = Object.freeze(${JSON.stringify(wrongIdentity)});`,
    `const decoyCorrectIdentity = Object.freeze(${JSON.stringify(identity)});`,
    'const nativeRequestHandler = () => undefined;',
    'const nativeCSRRequestHandler = () => undefined;',
    '__webpack_require__.d(__webpack_exports__, {',
    `  rendererIdentity: () => ${getterBinding},`,
    '  nativeRequestHandler: () => nativeRequestHandler,',
    '  nativeCSRRequestHandler: () => nativeCSRRequestHandler,',
    '});',
    ...(bridge === 'commonjs2'
      ? ['module.exports = __webpack_exports__;']
      : [
          'exports.rendererIdentity = __webpack_exports__.rendererIdentity;',
          'exports.nativeRequestHandler = __webpack_exports__.nativeRequestHandler;',
          'exports.nativeCSRRequestHandler = __webpack_exports__.nativeCSRRequestHandler;',
        ]),
    '',
  ].join('\n');
}

for (const bridge of ['assignments', 'commonjs2']) {
  for (const mutation of [
    undefined,
    'wrong-exported-binding',
    'decoy-correct-literal',
  ]) {
    test(`compiled target grammar ${bridge} ${mutation ?? 'authenticates frozen identity and handlers'}`, t => {
      const fixture = cohortFixture(t);
      write(
        fixture.bundleFile,
        nativeServerTargetExportSource(fixture.identity, bridge, mutation),
      );
      if (mutation) {
        assert.throws(
          () => auditInstalledConsumer(fixture.options),
          /identity conflicts with its finalized manifest/u,
        );
        return;
      }
      const report = auditInstalledConsumer(fixture.options);
      const target = report.entryClosure.find(
        entry => entry.path === 'dist/bundles/main.js',
      );
      assert.ok(
        target,
        'Export-table target must use the central closure audit',
      );
      assert.equal(
        target.sha256,
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(fixture.bundleFile))
          .digest('hex'),
      );
    });
  }
}

for (const mutation of [
  'no-op-bound-table',
  'uncalled-function',
  'false-branch',
  'module-exports-reset',
  'exports-rebind',
  'return-before-exports-iife',
  'prepopulated-wrong-identity',
]) {
  test(`compiled target grammar rejects ${mutation}`, t => {
    const fixture = cohortFixture(t);
    const valid = nativeServerTargetExportSource(
      fixture.identity,
      'assignments',
    );
    let source;
    if (mutation === 'no-op-bound-table') {
      source = [
        'const fake = { d: () => undefined };',
        'const namespace = {};',
        `const identity = Object.freeze(${JSON.stringify(fixture.identity)});`,
        'const handler = () => undefined;',
        'fake.d(namespace, { rendererIdentity: () => identity, nativeRequestHandler: () => handler, nativeCSRRequestHandler: () => handler });',
        'module.exports = namespace;',
      ].join('\n');
    } else if (mutation === 'uncalled-function')
      source = `function dormantExports() {\n${valid}\n}\n`;
    else if (mutation === 'false-branch')
      source = `if (false) {\n${valid}\n}\n`;
    else if (mutation === 'module-exports-reset')
      source = `${valid}\nmodule.exports = {};\n`;
    else if (mutation === 'return-before-exports-iife')
      source = `(() => {\nreturn;\n${valid}\n})();\n`;
    else if (mutation === 'prepopulated-wrong-identity') {
      const tableCall = '__webpack_require__.d(__webpack_exports__, {';
      assert.ok(valid.includes(tableCall));
      source = valid.replace(
        tableCall,
        `__webpack_exports__.rendererIdentity = Object.freeze(${JSON.stringify({ ...fixture.identity, buildId: 'f'.repeat(64) })});\n${tableCall}`,
      );
    } else source = `exports = {};\n${valid}`;
    write(fixture.bundleFile, source);
    assert.throws(() => auditInstalledConsumer(fixture.options));
  });
}

for (const format of ['cjs', 'esm', 'esm-named']) {
  for (const renderer of ['react', 'solid', 'octane']) {
    test(`${format} authenticated native server declaration admits the ${renderer} unit cohort`, t => {
      const fixture = cohortFixture(t, { format, renderer });
      if (renderer === 'react')
        fs.rmSync(path.join(fixture.consumerRoot, 'dist'), { recursive: true });
      const report = auditInstalledConsumer(fixture.options);
      assert.ok(
        report.producerArtifactBindings.some(binding => binding.name === ultra),
      );
      assert.ok(
        report.entryClosure.some(entry =>
          entry.path.endsWith(fixture.loaderFile),
        ),
      );
      if (renderer !== 'react') {
        const target = report.entryClosure.find(
          entry => entry.path === 'dist/bundles/main.js',
        );
        assert.ok(
          target,
          'Active native target must use the central scanned closure',
        );
        assert.equal(
          target.sha256,
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(fixture.bundleFile))
            .digest('hex'),
        );
      }
    });
  }
}

test('native loader declaration requires its producer and canonical installed owner bytes', t => {
  const fixture = cohortFixture(t);
  assert.throws(() =>
    auditInstalledConsumer({ ...fixture.options, releaseArtifacts: undefined }),
  );
  fs.appendFileSync(fixture.installedLoader, '\n// changed installed bytes\n');
  assert.throws(() => auditInstalledConsumer(fixture.options));
  const wrong = cohortFixture(t, { wrongFile: true });
  assert.throws(() => auditInstalledConsumer(wrong.options));
});

for (const mutation of [
  'removed-count',
  'removed-path',
  'reordered',
  'wrong-files-binding',
  'wrong-files-origin',
  'forged-path-wrapper',
  'wrong-identity-binding',
  'shadowed-path',
  'shadowed-url',
  'shadowed-core',
  'shadowed-utils',
  'missing-identity-assert',
  'wrong-handler',
  'extra-computed',
]) {
  test(`native loader rejects candidate-owned ${mutation} source`, t => {
    const fixture = cohortFixture(t, { mutation });
    assert.throws(() => auditInstalledConsumer(fixture.options));
  });
}

for (const injection of [
  'absent-manifest',
  'forged-manifest',
  'forged-source',
  'malformed-cohort-digest',
  'wrong-profile-tuple',
  'wrong-renderer',
  'forged-target',
  'target-react',
  'missing-target',
  'external-target',
  'symlink-target',
]) {
  test(`active native loader rejects ${injection}`, t => {
    const fixture = cohortFixture(t);
    if (injection === 'absent-manifest')
      delete fixture.options.rendererBuildManifestPath;
    else if (injection === 'forged-manifest')
      writeJson(fixture.manifestFile, { ...fixture.build, schema: 'forged' });
    else if (injection === 'forged-source')
      fixture.options.releaseArtifacts = {
        ...fixture.producer,
        sourceRevision: 'f'.repeat(40),
      };
    else if (injection === 'malformed-cohort-digest')
      writeJson(fixture.manifestFile, {
        ...fixture.build,
        frameworkCohortDigest: 'malformed',
      });
    else if (injection === 'wrong-profile-tuple')
      writeJson(fixture.manifestFile, {
        ...fixture.build,
        profile: {
          ...fixture.build.profile,
          dependencies: { [ultra]: '3.8.3-ultramodern.19' },
        },
      });
    else if (injection === 'wrong-renderer')
      writeJson(fixture.manifestFile, {
        ...fixture.build,
        identities: { main: { ...fixture.identity, renderer: 'octane' } },
      });
    else if (injection === 'forged-target')
      write(
        fixture.bundleFile,
        `export const rendererIdentity = ${JSON.stringify({ ...fixture.identity, buildId: 'f'.repeat(64) })};\nexport const nativeRequestHandler = () => undefined;\nexport const nativeCSRRequestHandler = () => undefined;\n`,
      );
    else if (injection === 'target-react')
      fs.appendFileSync(
        fixture.bundleFile,
        "\nconst BrowserServerLeak = Symbol.for('react.element');\n",
      );
    else {
      fs.rmSync(fixture.bundleFile);
      if (injection !== 'missing-target') {
        const targetRoot =
          injection === 'external-target'
            ? ownedDirectory(t)
            : path.join(fixture.consumerRoot, 'other');
        const target = path.join(targetRoot, 'main.js');
        write(target, 'export const native = true;\n');
        fs.symlinkSync(target, fixture.bundleFile);
      }
    }
    assert.throws(
      () => auditInstalledConsumer(fixture.options),
      undefined,
      injection,
    );
  });
}

test('browser-authored copies and arbitrary BrowserServerLeak imports receive no native loader exemption', t => {
  for (const injection of ['browser-copy', 'BrowserServerLeak']) {
    const fixture = cohortFixture(t);
    write(
      path.join(fixture.consumerRoot, 'browser.mjs'),
      injection === 'browser-copy'
        ? fixture.source
        : 'export async function BrowserServerLeak(file) { return import(file); }\n',
    );
    fixture.options.entryFiles.push('browser.mjs');
    assert.throws(() => auditInstalledConsumer(fixture.options));
  }
});
