const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  checkForkImportBoundary,
  createAllowlistSnapshot,
  scanUpstreamOwnedForkImports,
} = require('../checker');

const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-import-owner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'config', 'user.name', 'Fixture');
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const commit = () => {
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'fixture');
    return git(root, 'rev-parse', 'HEAD');
  };
  const manifest = (directory, name, fields = {}) =>
    write(
      `${directory}/package.json`,
      JSON.stringify({ name, 'modern:source': './src/index.ts', ...fields }),
    );
  manifest('packages/runtime/native', '@modern-js/native');
  write('packages/runtime/native/src/index.ts', 'export const native = true;');
  write('packages/runtime/native/src/stable.ts', 'export const stable = true;');
  write(
    'packages/runtime/native/src/fixtures/input.ts',
    'export const fixtureValue = true;',
  );
  manifest(
    'packages/toolkit/upstream-ultramodern-name',
    '@modern-js/ultramodern-but-upstream',
  );
  write(
    'packages/toolkit/upstream-ultramodern-name/src/index.ts',
    'export const upstream = true;',
  );
  const baseRef = commit();
  manifest('packages/toolkit/innocent', '@modern-js/ordinary', {
    exports: {
      '.': { 'modern:source': './src/index.ts' },
      './detail/*': { 'modern:source': './src/detail/*.ts' },
    },
  });
  write('packages/toolkit/innocent/src/index.ts', 'export const fork = true;');
  write(
    'packages/toolkit/innocent/src/detail/policy.ts',
    'export const policy = true;',
  );
  const source = 'packages/runtime/native/src/index.ts';
  const scan = headRef =>
    scanUpstreamOwnedForkImports({ rootDir: root, baseRef, headRef });
  return { root, baseRef, source, write, commit, manifest, scan };
};

test('ownership catches innocuous fork package names and deep source exports, while upstream names remain native', t => {
  const { source, write, scan } = fixture(t);
  write(
    source,
    `
    import '@modern-js/ordinary';
    export * from '@modern-js/ordinary/detail/policy';
    import '@modern-js/ultramodern-but-upstream';
    import 'some-ultramodern-related-external-library';
  `,
  );
  const violations = scan().violations;
  assert.deepEqual(
    violations.map(record => record.specifier),
    ['@modern-js/ordinary', '@modern-js/ordinary/detail/policy'],
  );
  assert.deepEqual(violations[1].targets, [
    'packages/toolkit/innocent/src/detail/policy.ts',
  ]);
});

test('measured workspace patterns distinguish nested packages from fixture manifests without exempting fixture sources', t => {
  const { source, write, manifest, scan } = fixture(t);
  write(
    'pnpm-workspace.yaml',
    "packages:\n  - 'packages/runtime/*'\n  - 'packages/toolkit/*'\n  - 'packages/toolkit/parent/*'\n",
  );
  manifest('packages/toolkit/parent', '@modern-js/parent');
  manifest('packages/toolkit/parent/nested', '@modern-js/nested');
  write(
    'packages/toolkit/parent/nested/src/index.ts',
    'export const nested = true;',
  );
  // A fixture cannot impersonate a real package by overwriting its name.
  manifest('packages/runtime/native/src/fixtures', '@modern-js/ordinary');
  write(
    'packages/runtime/native/src/fixtures/input.ts',
    "import '@modern-js/ordinary';",
  );
  write(source, "import '@modern-js/nested';");
  const violations = scan().violations;
  assert.equal(violations.length, 2);
  assert.ok(
    violations.some(
      record =>
        record.targets[0] === 'packages/toolkit/parent/nested/src/index.ts',
    ),
  );
  assert.ok(
    violations.some(record => record.file.endsWith('/fixtures/input.ts')),
  );
});

test('actual ownership scanning uses only the CI-provided Babel dependency, without YAML packages or generated bundles', t => {
  const { root, baseRef, source, write } = fixture(t);
  write(
    'pnpm-workspace.yaml',
    "packages:\n  - 'packages/runtime/*' # native\n  - 'packages/toolkit/*' # fork\nmetadata:\n  enabled: false\n",
  );
  write(
    'packages/runtime/native/tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { policy: ['../../toolkit/innocent/src/index.ts'] },
      },
    }),
  );
  write(source, "export * from 'policy';\n");
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `
        const Module = require('node:module');
        const path = require('node:path');
        const parser = require.resolve('@babel/core');
        const resolve = Module._resolveFilename;
        Module._resolveFilename = function (specifier, parent, ...args) {
          if (specifier === '@babel/core') return parser;
          if (!Module.isBuiltin(specifier) &&
              !specifier.startsWith('.') && !path.isAbsolute(specifier) &&
              !parent?.filename.includes('/node_modules/')) {
            throw new Error('CI does not provide dependency: ' + specifier);
          }
          const result = resolve.call(this, specifier, parent, ...args);
          if (result.includes('/packages/toolkit/utils/compiled/')) {
            throw new Error('Generated bundles are absent from CI');
          }
          return result;
        };
        const report = require(process.argv[1]).scanUpstreamOwnedForkImports({
          rootDir: process.argv[2], baseRef: process.argv[3],
        });
        process.stdout.write(JSON.stringify(report.violations));
      `,
      path.join(__dirname, '../checker.js'),
      root,
      baseRef,
    ],
    {
      cwd: path.join(__dirname, '../../..'),
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
    },
  );
  const violations = JSON.parse(output);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].specifier, 'policy');
  assert.deepEqual(violations[0].targets, [
    'packages/toolkit/innocent/src/index.ts',
  ]);
});

test('AST references include literal dynamic imports, require, import types and import-equals without matching comments', t => {
  const { source, write, scan } = fixture(t);
  write(
    source,
    `
    // import '@modern-js/ordinary/comment';
    const text = "import '@modern-js/ordinary/string'";
    import('@modern-js/ordinary/detail/policy');
    require('@modern-js/ordinary');
    type Policy = import('@modern-js/ordinary/src/detail/policy').Policy;
    import policy = require('@modern-js/ordinary/detail/policy');
    import(\`@modern-js/ordinary/template\`);
    require(\`@modern-js/ordinary/required-template\`);
  `,
  );
  assert.deepEqual(
    scan().violations.map(record => record.specifier),
    [
      '@modern-js/ordinary',
      '@modern-js/ordinary/detail/policy',
      '@modern-js/ordinary/required-template',
      '@modern-js/ordinary/src/detail/policy',
      '@modern-js/ordinary/template',
    ],
  );
});

test('relative deep imports retain target package ownership while native helpers keep their package owner', t => {
  const { source, write, scan } = fixture(t);
  write(
    'packages/runtime/native/src/new-policy.ts',
    'export const policy = true;',
  );
  write(
    source,
    `import './new-policy'; import '../../../toolkit/innocent/src/detail/policy.js'; import './stable';`,
  );
  assert.deepEqual(
    scan()
      .violations.map(record => record.targets[0])
      .sort(),
    ['packages/toolkit/innocent/src/detail/policy.ts'],
  );
});

test('npm, workspace and local package aliases cannot disguise fork ownership', t => {
  const { source, manifest, write, scan } = fixture(t);
  manifest('packages/runtime/native', '@modern-js/native', {
    dependencies: {
      first: 'npm:@modern-js/ordinary@1',
      second: 'workspace:@modern-js/ordinary@*',
      third: 'file:../../toolkit/innocent',
      fourth: 'workspace:../../toolkit/innocent',
    },
  });
  write(
    source,
    `import 'first/detail/policy'; import 'second'; import 'third'; import 'fourth';`,
  );
  assert.equal(scan().violations.length, 4);
  assert.ok(
    scan().violations.every(record =>
      record.markers.includes('@modern-js/ordinary'),
    ),
  );
});

test('package imports aliases resolve conditional and wildcard source targets, with measured metadata and cycles rejected', t => {
  const { source, write, manifest, scan, commit } = fixture(t);
  const root = 'packages/runtime/native';
  manifest(root, '@modern-js/native', {
    imports: {
      '#fork': { node: '@modern-js/ordinary', default: './src/stable.ts' },
      '#detail/*': '@modern-js/ordinary/detail/*',
      '#source': {
        'modern:source': './src/stable.ts',
        default: '@modern-js/ordinary',
      },
      '#cycle-one': '#cycle-two',
      '#cycle-two': '#cycle-one',
    },
  });
  write(source, "import '#fork'; import '#detail/policy'; import '#source';");
  const head = commit();
  assert.equal(scan().violations.length, 2);
  manifest(root, '@modern-js/native', {
    imports: {
      '#fork': './src/stable.ts',
      '#detail/*': './src/stable.ts',
      '#source': './src/stable.ts',
    },
  });
  assert.equal(scan().violations.length, 0);
  assert.equal(scan(head).violations.length, 2);
  manifest(root, '@modern-js/native', {
    imports: { '#cycle-one': '#cycle-two', '#cycle-two': '#cycle-one' },
  });
  write(source, "import '#cycle-one';");
  assert.throws(scan, /Cyclic package imports alias/);
});

test('TypeScript source aliases take precedence over package imports aliases that would hide a fork target', t => {
  const { source, manifest, write, scan } = fixture(t);
  manifest('packages/runtime/native', '@modern-js/native', {
    imports: { '#policy': './src/stable.ts' },
  });
  write(
    'tsconfig.json',
    '{"compilerOptions":{"baseUrl":".","paths":{"#policy":["packages/toolkit/innocent/src/index.ts"]}}}',
  );
  write(source, "import '#policy';");
  assert.deepEqual(scan().violations[0].targets, [
    'packages/toolkit/innocent/src/index.ts',
  ]);
});

test('new source files inside native packages cannot hide a fork dependency reversal behind a local shim', t => {
  const { source, write, scan } = fixture(t);
  const shim = 'packages/runtime/native/src/shim.ts';
  write(shim, "export * from '@modern-js/ordinary';");
  write(source, "export * from './shim';");
  const violations = scan().violations;
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, shim);
});

test('TypeScript aliases resolve measured JSONC configs, including inherited paths and aliases to native modules', t => {
  const { source, write, scan, commit } = fixture(t);
  write(
    'tsconfig.base.json',
    `{
    // A source alias does not change who owns the module.
    "compilerOptions": { "baseUrl": ".", "paths": {
      "policy/*": ["packages/toolkit/innocent/src/detail/*"],
      "native": ["packages/runtime/native/src/stable.ts"],
    }, },
  }`,
  );
  write(
    'packages/runtime/native/tsconfig.json',
    '{ "extends": "../../../tsconfig.base.json" }',
  );
  write(source, `import 'policy/policy'; import 'native';`);
  const head = commit();
  assert.equal(scan().violations.length, 1);
  write('tsconfig.base.json', '{"compilerOptions":{"paths":{}}}');
  assert.equal(
    scan(head).violations.length,
    1,
    'committed scan uses committed alias metadata',
  );
});

test('child path aliases use inherited baseUrl and classify the actual fork target even when the alias names a native package', t => {
  const { source, write, scan } = fixture(t);
  write(
    'tsconfig.base.json',
    '{"compilerOptions":{"baseUrl":"packages/toolkit/innocent"}}',
  );
  write(
    'packages/runtime/native/tsconfig.json',
    '{"extends":"../../../tsconfig.base.json","compilerOptions":{"paths":{"@modern-js/native":["src/index.ts"]}}}',
  );
  write(source, "import '@modern-js/native';");
  assert.deepEqual(scan().violations[0].targets, [
    'packages/toolkit/innocent/src/index.ts',
  ]);
});

test('child baseUrl overrides apply to inherited paths and cannot mistake native shadow files for the fork target', t => {
  const { source, write, scan } = fixture(t);
  write(
    'tsconfig.base.json',
    '{"compilerOptions":{"baseUrl":"packages/toolkit/innocent","paths":{"@modern-js/ordinary":["src/index.ts"]}}}',
  );
  write(
    'packages/runtime/native/tsconfig.json',
    '{"extends":"../../../tsconfig.base.json","compilerOptions":{"baseUrl":"../../toolkit/upstream-ultramodern-name"}}',
  );
  write(source, "import '@modern-js/ordinary';");
  assert.equal(scan().violations.length, 0);
  write(
    'packages/runtime/native/tsconfig.json',
    '{"extends":"../../../tsconfig.base.json","compilerOptions":{"baseUrl":"../../toolkit/innocent"}}',
  );
  assert.deepEqual(scan().violations[0].targets, [
    'packages/toolkit/innocent/src/index.ts',
  ]);
});

test('an exact TypeScript alias wins over a longer wildcard that would shadow the fork target', t => {
  const { source, write, scan } = fixture(t);
  write(
    'tsconfig.json',
    '{"compilerOptions":{"baseUrl":".","paths":{"policy":["packages/toolkit/innocent/src/index.ts"],"policy*":["packages/runtime/native/src/stable.ts"]}}}',
  );
  write(source, "import 'policy';");
  assert.deepEqual(scan().violations[0].targets, [
    'packages/toolkit/innocent/src/index.ts',
  ]);
});

test('TypeScript wildcard aliases choose the longest prefix rather than the longest total pattern', t => {
  const { source, write, scan } = fixture(t);
  write(
    'tsconfig.json',
    '{"compilerOptions":{"baseUrl":".","paths":{"p*longsuffix":["packages/runtime/native/src/stable.ts"],"policy*":["packages/toolkit/innocent/src/index.ts"]}}}',
  );
  write(source, "import 'policylongsuffix';");
  assert.deepEqual(scan().violations[0].targets, [
    'packages/toolkit/innocent/src/index.ts',
  ]);
});

test('TypeScript baseUrl source imports retain actual package ownership without a paths declaration', t => {
  const { source, write, scan } = fixture(t);
  write('tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}');
  write(
    source,
    "import 'packages/toolkit/innocent/src/index'; import 'packages/runtime/native/src/stable';",
  );
  assert.deepEqual(scan().violations[0].targets, [
    'packages/toolkit/innocent/src/index.ts',
  ]);
  assert.equal(scan().violations.length, 1);
});

test('upstream source and package ownership survive renames into new roots and names', t => {
  const { root, source, write, manifest, scan, commit } = fixture(t);
  const stable = Array.from(
    { length: 12 },
    (_, index) => `export const stable${index} = ${index};`,
  ).join('\n');
  write(source, stable);
  commit();
  const moved = 'packages/runtime/native/src/moved.ts';
  git(root, 'mv', source, moved);
  write(moved, `${stable}\nimport '@modern-js/ordinary';`);
  let head = commit();
  assert.equal(scan(head).violations[0].file, moved);
  const outsideSource = 'packages/runtime/native/lib/moved.ts';
  fs.mkdirSync(path.dirname(path.join(root, outsideSource)), {
    recursive: true,
  });
  git(root, 'mv', moved, outsideSource);
  head = commit();
  assert.equal(
    scan(head).violations[0].file,
    outsideSource,
    'moving outside src does not erase audited source ownership',
  );
  git(
    root,
    'mv',
    'packages/toolkit/upstream-ultramodern-name',
    'packages/toolkit/renamed',
  );
  manifest('packages/toolkit/renamed', '@modern-js/new-upstream-name');
  write(outsideSource, `${stable}\nimport '@modern-js/new-upstream-name';`);
  head = commit();
  assert.equal(scan(head).violations.length, 0);
});

test('an exact ledger-backed bridge permits only the reviewed source, specifier and target', t => {
  const { root, baseRef, source, write, scan } = fixture(t);
  const target = 'packages/toolkit/innocent/src/index.ts';
  const bridge = {
    file: source,
    specifier: '@modern-js/ordinary',
    target,
    owner: 'bleedingdev',
    reason: 'Preserve existing native plugin composition.',
  };
  const allowlistPath = path.join(root, 'allowlist.json');
  write(
    'allowlist.json',
    JSON.stringify(
      createAllowlistSnapshot({ baseRef, violations: [], bridges: [bridge] }),
    ),
  );
  write(
    'FORK-DIVERGENCE.md',
    `<!-- fork-evidence:v1 -->\n\`\`\`json\n${JSON.stringify({ schemaVersion: 1, entries: [{ path: source, owner: bridge.owner, reason: bridge.reason, dispositions: ['inline-patch'] }] })}\n\`\`\`\n<!-- /fork-evidence:v1 -->`,
  );
  write(source, `import '@modern-js/ordinary';`);
  assert.equal(scan().violations.length, 1);
  assert.equal(
    checkForkImportBoundary({ rootDir: root, baseRef, allowlistPath }).ok,
    true,
  );
  write(source, `import '@modern-js/ordinary/detail/policy';`);
  assert.equal(
    checkForkImportBoundary({ rootDir: root, baseRef, allowlistPath }).ok,
    false,
  );
  write(
    'allowlist.json',
    JSON.stringify(
      createAllowlistSnapshot({
        baseRef,
        violations: [],
        bridges: [{ ...bridge, specifier: '@modern-js/ordinary/*' }],
      }),
    ),
  );
  assert.throws(
    () => checkForkImportBoundary({ rootDir: root, baseRef, allowlistPath }),
    /exact source/,
  );
});

test('malformed governed source and metadata fail closed', t => {
  const { root, baseRef, source, write, scan } = fixture(t);
  write(source, 'import { broken');
  assert.throws(scan, /Cannot parse governed import source/);
  write(source, `import 'hidden';`);
  write(
    'packages/runtime/native/tsconfig.json',
    '{"compilerOptions":{"paths":{"hidden":["missing"]}}}',
  );
  assert.throws(scan, /Unresolved TypeScript path alias/);
  write('packages/runtime/native/tsconfig.json', '{}');
  fs.symlinkSync(
    '../../../toolkit/innocent/src/index.ts',
    path.join(root, 'packages/runtime/native/src/hidden.ts'),
  );
  write(source, "import './hidden';");
  assert.throws(scan, /without symlinks/);
  fs.rmSync(path.join(root, 'packages/runtime/native/src/hidden.ts'));
  write('packages/toolkit/innocent/package.json', '{broken');
  assert.throws(
    () => scanUpstreamOwnedForkImports({ rootDir: root, baseRef }),
    SyntaxError,
  );
});
