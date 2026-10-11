const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scanUpstreamOwnedForkImports } = require('../checker');

const nativeDirectory = 'packages/runtime/native';
const configDirectory = 'packages/toolkit/config';
const source = `${nativeDirectory}/src/index.ts`;
const forkTarget = 'packages/toolkit/innocent/src/index.ts';
const nativePaths = {
  compilerOptions: {
    paths: { policy: ['../../runtime/native/src/stable.ts'] },
  },
};
const forkPaths = {
  compilerOptions: { paths: { policy: ['../innocent/src/index.ts'] } },
};

const fixture = (t, { manifest = {}, extends: parents, directoryManifest }) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-tsconfig-extends-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const json = (file, value) => write(file, JSON.stringify(value));
  const commit = () => {
    git('add', '.');
    git('commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  write(
    'pnpm-workspace.yaml',
    "packages:\n  - 'packages/runtime/*'\n  - 'packages/toolkit/*'\n",
  );
  json(`${nativeDirectory}/package.json`, {
    name: '@modern-js/native',
    'modern:source': './src/index.ts',
    dependencies: { '@workspace/config': 'workspace:*' },
  });
  write(source, 'export const native = true;');
  write(`${nativeDirectory}/src/stable.ts`, 'export const stable = true;');
  json(`${nativeDirectory}/tsconfig.json`, { extends: parents });
  json(`${nativeDirectory}/local.json`, {
    compilerOptions: { paths: { policy: ['./src/stable.ts'] } },
  });
  json(`${configDirectory}/package.json`, {
    name: '@workspace/config',
    'modern:source': './src/index.ts',
    main: './module.json',
    ...manifest,
  });
  write(`${configDirectory}/src/index.ts`, 'export const config = true;');
  for (const file of [
    'tsconfig.json',
    'tsconfig.base.json',
    'module.json',
    'policy.json',
    'export.json',
  ]) {
    json(`${configDirectory}/${file}`, nativePaths);
  }
  if (directoryManifest) {
    json(`${nativeDirectory}/src/redirect/package.json`, {
      name: 'native-directory',
      ...directoryManifest,
    });
    write(
      `${nativeDirectory}/src/redirect/index.ts`,
      'export const stableDirectory = true;',
    );
  }
  const baseRef = commit();
  json('packages/toolkit/innocent/package.json', {
    name: '@modern-js/ordinary',
    'modern:source': './src/index.ts',
  });
  write(forkTarget, 'export const fork = true;');
  write(source, "import 'policy';");
  const scan = headRef =>
    scanUpstreamOwnedForkImports({ rootDir: root, baseRef, headRef });
  return { root, write, json, commit, scan };
};

const assertForkTarget = (report, specifier = 'policy') => {
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].file, source);
  assert.equal(report.violations[0].specifier, specifier);
  assert.deepEqual(report.violations[0].targets, [forkTarget]);
};
const assertMeasuredConfig = (setup, configFile) => {
  setup.json(`${configDirectory}/${configFile}`, forkPaths);
  assertForkTarget(setup.scan());
  const headRef = setup.commit();
  assertForkTarget(setup.scan(headRef));
  setup.json(`${configDirectory}/${configFile}`, nativePaths);
  assert.equal(setup.scan().violations.length, 0);
  assertForkTarget(setup.scan(headRef));
};

test('workspace package extends follows its measured tsconfig field instead of module entry points', t => {
  const setup = fixture(t, {
    extends: '@workspace/config',
    manifest: { tsconfig: './tsconfig.base.json' },
  });
  assertMeasuredConfig(setup, 'tsconfig.base.json');
});

test('workspace package extends defaults to tsconfig.json and overrides an earlier array parent', t => {
  const setup = fixture(t, {
    extends: ['./local.json', '@workspace/config'],
  });
  assertMeasuredConfig(setup, 'tsconfig.json');
});

for (const parent of ['@workspace/config', '@workspace/config/policy']) {
  test(`workspace config exports select the inherited JSON for ${parent}`, t => {
    const setup = fixture(t, {
      extends: parent,
      manifest: {
        tsconfig: './tsconfig.base.json',
        exports: { '.': './export.json', './policy': './export.json' },
      },
    });
    assertMeasuredConfig(setup, 'export.json');
  });
}

for (const conditions of [
  {
    'modern:source': './module.json',
    import: './tsconfig.base.json',
    default: './export.json',
  },
  { types: './export.json', default: './module.json' },
  { node: './export.json', default: './module.json' },
  { require: './export.json', default: './module.json' },
  { default: './export.json', types: './module.json' },
]) {
  test(`workspace config export conditions respect ${Object.keys(conditions).join(', ')} order`, t => {
    const setup = fixture(t, {
      extends: '@workspace/config',
      manifest: { exports: { '.': conditions } },
    });
    assertMeasuredConfig(setup, 'export.json');
  });
}

test('workspace package subpath extends resolves an extensionless JSON file without exports', t => {
  const setup = fixture(t, {
    extends: '@workspace/config/policy',
    manifest: { tsconfig: './tsconfig.base.json' },
  });
  assertMeasuredConfig(setup, 'policy.json');
});

test('missing measured workspace config cannot silently discard inherited policy', t => {
  const setup = fixture(t, {
    extends: '@workspace/config/missing',
    manifest: { tsconfig: './tsconfig.base.json' },
  });
  assert.throws(setup.scan, /Unresolved TypeScript configuration/);
  const headRef = setup.commit();
  assert.throws(
    () => setup.scan(headRef),
    /Unresolved TypeScript configuration/,
  );
});

for (const entry of ['types', 'main']) {
  test(`directory path aliases follow measured ${entry} metadata before an audited index`, t => {
    const target = '../../../../toolkit/innocent/src/index.ts';
    const setup = fixture(t, {
      extends: '@workspace/config',
      directoryManifest: { [entry]: target },
    });
    setup.json(`${nativeDirectory}/tsconfig.json`, {
      compilerOptions: { paths: { policy: ['src/redirect'] } },
    });
    assertForkTarget(setup.scan());
    const headRef = setup.commit();
    assertForkTarget(setup.scan(headRef));
    setup.json(`${nativeDirectory}/src/redirect/package.json`, {
      name: 'native-directory',
      [entry]: './index.ts',
    });
    assert.equal(setup.scan().violations.length, 0);
    assertForkTarget(setup.scan(headRef));
  });

  test(`relative TypeScript imports follow measured ${entry} metadata before an audited index`, t => {
    const target = '../../../../toolkit/innocent/src/index.ts';
    const setup = fixture(t, {
      extends: '@workspace/config',
      directoryManifest: { [entry]: target },
    });
    setup.write(source, "import './redirect';");
    assertForkTarget(setup.scan(), './redirect');
    const headRef = setup.commit();
    assertForkTarget(setup.scan(headRef), './redirect');
    setup.json(`${nativeDirectory}/src/redirect/package.json`, {
      name: 'native-directory',
      [entry]: './index.ts',
    });
    assert.equal(setup.scan().violations.length, 0);
    assertForkTarget(setup.scan(headRef), './redirect');
  });
}

test('cyclic measured directory metadata cannot hide an alias behind its native index', t => {
  const setup = fixture(t, {
    extends: '@workspace/config',
    directoryManifest: { types: '../redirect' },
  });
  setup.json(`${nativeDirectory}/tsconfig.json`, {
    compilerOptions: { paths: { policy: ['src/redirect'] } },
  });
  assert.throws(setup.scan, /Cyclic .*directory/);
  const headRef = setup.commit();
  assert.throws(() => setup.scan(headRef), /Cyclic .*directory/);
});
