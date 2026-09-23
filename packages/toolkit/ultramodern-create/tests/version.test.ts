import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

// Keeps every spawned CLI hermetic: no test may dial the npm registry for
// the @bleedingdev/modern-js-ultramodern-create framework cohort.
const hermeticEnv = {
  ...process.env,
  ULTRAMODERN_CREATE_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
};

const writeExecutable = (filePath: string, content: string) => {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
};

function linkGeneratedConfigRuntime(
  workspacePath: string,
  appDirectory: string,
) {
  fs.symlinkSync(
    path.resolve(packageRoot, '../../../node_modules/.pnpm/node_modules'),
    path.join(workspacePath, 'node_modules'),
    'dir',
  );
  const modernScope = path.join(
    workspacePath,
    'apps',
    appDirectory,
    'node_modules/@modern-js',
  );
  fs.mkdirSync(modernScope, { recursive: true });
  for (const [name, relativePath] of [
    ['app-tools', '../../solutions/app-tools'],
    ['app-tools-extensions', '../../solutions/app-tools-extensions'],
    ['ultramodern-app-tools', '../../solutions/ultramodern-app-tools'],
    ['plugin-i18n', '../../runtime/plugin-i18n'],
    ['plugin-tanstack', '../../runtime/plugin-tanstack'],
  ]) {
    fs.symlinkSync(
      path.resolve(packageRoot, relativePath),
      path.join(modernScope, name),
      'dir',
    );
  }
}

// Evaluates the generated modern.config.ts the way the app build does, so the
// assertion is the asset prefix a browser would receive, not config text.
function loadGeneratedAssetPrefix(
  workspacePath: string,
  appDirectory: string,
  env: Record<string, string | undefined>,
) {
  const configPath = path.join(
    workspacePath,
    'apps',
    appDirectory,
    'modern.config.ts',
  );
  const tsxLoader = pathToFileURL(
    fs.realpathSync(path.join(packageRoot, 'node_modules/tsx/dist/loader.mjs')),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      tsxLoader,
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        import { createRequire } from 'node:module';
        import { pathToFileURL } from 'node:url';
        const loaded = await import(pathToFileURL(${JSON.stringify(configPath)}).href);
        const config = loaded.default?.default ?? loaded.default;
        const require = createRequire(pathToFileURL(${JSON.stringify(configPath)}));
        const appToolsRequire = createRequire(require.resolve('@modern-js/app-tools'));
        const rsbuildRequire = createRequire(appToolsRequire.resolve('@rsbuild/core'));
        const { rspack } = rsbuildRequire('@rspack/core');
        const compiler = rspack({ mode: 'none', resolve: { alias: config.source.alias } });
        try {
          const resolver = compiler.resolverFactory.get('normal', {});
          for (const [request, target] of [
            ['runtime', 'runtime/no-react-i18next'],
            ['runtime/consumer', 'runtime/consumer'],
          ]) {
            assert.equal(
              resolver.resolveSync({}, process.cwd(), '@modern-js/plugin-i18n/' + request),
              require.resolve('@modern-js/plugin-i18n/' + target),
            );
          }
        } finally {
          await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
        }
        process.stdout.write(JSON.stringify(config.output.assetPrefix));
      `,
    ],
    {
      cwd: path.dirname(configPath),
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as string;
}

test('built public UltraModern subpath imports from an ESM consumer and generates a vertical', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-create-public-api-'),
  );

  try {
    const scopeDir = path.join(tempRoot, 'node_modules/@modern-js');
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(
      packageRoot,
      path.join(scopeDir, 'ultramodern-create'),
      'dir',
    );

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import fs from 'node:fs';
          import path from 'node:path';
          import {
            addUltramodernVertical,
            generateUltramodernWorkspace,
          } from '@modern-js/ultramodern-create/ultramodern-workspace';

          const workspaceRoot = path.join(process.cwd(), 'public-api-workspace');
          generateUltramodernWorkspace({
            targetDir: workspaceRoot,
            packageName: 'public-api-workspace',
            modernVersion: '3.2.1',
            enableTailwind: true,
            packageSource: { strategy: 'workspace' },
          });
          addUltramodernVertical({
            workspaceRoot,
            name: 'catalog',
            modernVersion: '3.2.1',
          });
          for (const relativePath of [
            'topology/reference-topology.json',
            'apps/shell-super-app/package.json',
            'verticals/catalog/package.json',
            'verticals/catalog/shared/api.ts',
          ]) {
            if (!fs.existsSync(path.join(workspaceRoot, relativePath))) {
              throw new Error(\`Missing generated path: \${relativePath}\`);
            }
          }
        `,
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('built CLI scaffolds a workspace whose asset prefix resolves by precedence', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'smoke-workspace', '--no-tailwind'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: hermeticEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const workspacePath = path.join(tmpDir, 'smoke-workspace');
    assert.ok(
      fs.existsSync(
        path.join(workspacePath, 'topology/reference-topology.json'),
      ),
    );

    linkGeneratedConfigRuntime(workspacePath, 'shell-super-app');
    const precedence: [string | undefined, string | undefined, string][] = [
      [
        'https://modern.example/assets/',
        'https://ultramodern.example/assets/',
        'https://modern.example/assets/',
      ],
      [
        undefined,
        'https://ultramodern.example/assets/',
        'https://ultramodern.example/assets/',
      ],
      [undefined, undefined, '/'],
    ];
    for (const [modern, ultramodern, expected] of precedence) {
      assert.equal(
        loadGeneratedAssetPrefix(workspacePath, 'shell-super-app', {
          MODERN_ASSET_PREFIX: modern,
          MODERN_PUBLIC_SITE_URL: 'https://site.example/',
          ULTRAMODERN_ASSET_PREFIX: ultramodern,
        }),
        expected,
      );
    }
  } finally {
    fs.rmSync(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});

test('local source initializes Git offline and leaves the first commit to the user', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));
  const fakeBinDir = path.join(tmpDir, 'fake-bin');
  const hooksDir = path.join(tmpDir, 'hooks');
  const hookMarker = path.join(tmpDir, 'pre-commit-ran');
  const isolatedGitConfig = path.join(tmpDir, 'gitconfig');
  fs.mkdirSync(fakeBinDir);
  fs.mkdirSync(hooksDir);
  // A failing npm proves the registry is never required on this path.
  writeExecutable(path.join(fakeBinDir, 'npm'), '#!/bin/sh\nexit 1\n');
  writeExecutable(
    path.join(hooksDir, 'pre-commit'),
    '#!/bin/sh\n: > "$ULTRAMODERN_TEST_HOOK_MARKER"\n',
  );
  // Background maintenance (auto gc, fsmonitor) would keep writing into .git
  // after `git commit` returns and race the cleanup below (ENOTEMPTY on macOS).
  const gitConfig = `[core]\n\thooksPath = ${JSON.stringify(hooksDir)}\n\tfsmonitor = false\n[user]\n\tname = Scaffold Test\n\temail = scaffold@example.test\n[commit]\n\tgpgsign = false\n[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n`;
  fs.writeFileSync(isolatedGitConfig, gitConfig);
  const env = {
    ...hermeticEnv,
    GIT_CONFIG_GLOBAL: isolatedGitConfig,
    PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    ULTRAMODERN_TEST_HOOK_MARKER: hookMarker,
  };
  const workspaceDir = path.join(tmpDir, 'offline-fallback-smoke');
  const git = (args: string[]) =>
    spawnSync('git', args, { cwd: workspaceDir, env, encoding: 'utf8' });

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'offline-fallback-smoke'],
      { cwd: tmpDir, encoding: 'utf8', env },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      git(['symbolic-ref', '--short', 'HEAD']).stdout.trim(),
      'main',
    );
    // No commit, nothing staged, no hook run, no identity written: the user's
    // own first commit (through their own hooks) must still be the first one.
    assert.notEqual(git(['rev-parse', '--verify', 'HEAD']).status, 0);
    assert.equal(git(['diff', '--cached', '--name-only']).stdout, '');
    assert.equal(fs.existsSync(hookMarker), false);
    assert.equal(fs.readFileSync(isolatedGitConfig, 'utf8'), gitConfig);
    assert.equal(git(['config', '--local', '--get', 'user.name']).status, 1);

    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'),
    );
    assert.equal(
      rootPackage.devDependencies['@modern-js/ultramodern-create'],
      'workspace:*',
    );

    const add = git(['add', '.']);
    assert.equal(add.status, 0, add.stderr);
    const commit = git(['commit', '-m', 'test: explicitly commit scaffold']);
    assert.equal(commit.status, 0, commit.stderr);
    assert.equal(fs.existsSync(hookMarker), true);
    assert.equal(git(['rev-parse', '--verify', 'HEAD']).status, 0);
  } finally {
    fs.rmSync(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});

test('creation inside a repository preserves its HEAD and staged changes', () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-create-parent-'),
  );
  const parentDir = path.join(tmpDir, 'parent');
  const hooksDir = path.join(tmpDir, 'hooks');
  const hookMarker = path.join(tmpDir, 'pre-commit-ran');
  const isolatedGitConfig = path.join(tmpDir, 'gitconfig');
  fs.mkdirSync(parentDir);
  fs.mkdirSync(hooksDir);
  writeExecutable(
    path.join(hooksDir, 'pre-commit'),
    '#!/bin/sh\n: > "$ULTRAMODERN_TEST_HOOK_MARKER"\n',
  );
  fs.writeFileSync(
    isolatedGitConfig,
    `[core]\n\thooksPath = ${JSON.stringify(hooksDir)}\n[user]\n\tname = Parent Test\n\temail = parent@example.test\n[commit]\n\tgpgsign = false\n`,
  );
  const env = {
    ...hermeticEnv,
    GIT_CONFIG_GLOBAL: isolatedGitConfig,
    ULTRAMODERN_TEST_HOOK_MARKER: hookMarker,
  };
  const git = (args: string[]) => {
    const result = spawnSync('git', args, {
      cwd: parentDir,
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };

  try {
    git(['init', '-b', 'consumer']);
    fs.writeFileSync(path.join(parentDir, 'tracked.txt'), 'original\n');
    git(['add', '.']);
    git(['commit', '-m', 'test: parent baseline']);
    fs.rmSync(hookMarker);
    fs.writeFileSync(
      path.join(parentDir, 'tracked.txt'),
      'staged user change\n',
    );
    git(['add', 'tracked.txt']);
    const beforeHead = git(['rev-parse', 'HEAD']);
    const beforeIndex = git(['diff', '--cached', '--binary']);
    const beforeConfig = fs.readFileSync(
      path.join(parentDir, '.git/config'),
      'utf8',
    );
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'nested-workspace'],
      { cwd: parentDir, env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.existsSync(path.join(parentDir, 'nested-workspace/.git')),
      false,
    );
    assert.equal(git(['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(['diff', '--cached', '--binary']), beforeIndex);
    assert.equal(
      fs.readFileSync(path.join(parentDir, '.git/config'), 'utf8'),
      beforeConfig,
    );
    assert.equal(fs.existsSync(hookMarker), false);
  } finally {
    fs.rmSync(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});

test('missing git fails fast without attempting a system package install', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));
  const fakeBinDir = path.join(tmpDir, 'fake-bin');
  const brewMarker = path.join(tmpDir, 'brew-was-invoked');
  fs.mkdirSync(fakeBinDir);
  // PATH contains a fake brew but no git. The old CLI ran package-manager
  // installs (brew/apt-get with sudo) here; the new CLI must fail with an
  // actionable error without ever invoking them.
  writeExecutable(
    path.join(fakeBinDir, 'brew'),
    `#!/bin/sh\ntouch '${brewMarker}'\nexit 0\n`,
  );

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'missing-git-smoke'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        env: {
          ...hermeticEnv,
          PATH: fakeBinDir,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Git is required for UltraModern setup/);
    assert.equal(
      fs.existsSync(brewMarker),
      false,
      'create must never attempt to install git through a package manager',
    );
  } finally {
    fs.rmSync(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
