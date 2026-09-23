import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { generatedToolingCommands } from '../src/ultramodern-workspace/tooling-command-catalog';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(__dirname, '..');

function createInstalledFixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-installed-template-')),
  );
  const installedPackage = path.join(
    root,
    'node_modules/@modern-js/ultramodern-create',
  );
  try {
    fs.mkdirSync(installedPackage, { recursive: true });
    return { root, installedPackage };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function installTemplate(installedPackage: string, templatePath: string) {
  const target = path.join(installedPackage, templatePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Copy the actual shipped source: a symlink back to the repository would
  // avoid Node's installed-package restriction and miss this regression.
  fs.copyFileSync(path.join(packageRoot, templatePath), target);
  assert.ok(
    fs.realpathSync(target).includes(`${path.sep}node_modules${path.sep}`),
  );
  return target;
}

test('every packaged executable template is JavaScript that Node accepts inside node_modules', () => {
  const { root, installedPackage } = createInstalledFixture();
  try {
    for (const command of generatedToolingCommands) {
      if (!command.templatePath) continue;
      const target = installTemplate(installedPackage, command.templatePath);
      const result = spawnSync(process.execPath, ['--check', target], {
        cwd: root,
        encoding: 'utf8',
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `${command.command}: ${result.stderr}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the installed workerd proof reaches its native validation through plain Node', () => {
  const { root, installedPackage } = createInstalledFixture();
  try {
    const command = generatedToolingCommands.find(
      entry => entry.id === 'cloudflareSsrProof',
    );
    assert.ok(command?.templatePath);
    const target = installTemplate(installedPackage, command.templatePath);
    const dependencies = path.join(installedPackage, 'node_modules');
    fs.mkdirSync(dependencies);
    fs.symlinkSync(
      path.dirname(require.resolve('miniflare/package.json')),
      path.join(dependencies, 'miniflare'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    fs.mkdirSync(path.join(root, 'topology'));
    fs.writeFileSync(
      path.join(root, 'topology/reference-topology.json'),
      JSON.stringify({ schemaVersion: 1, shell: null, verticals: [] }),
    );
    fs.mkdirSync(path.join(root, 'topology/local-overlays'));
    fs.writeFileSync(
      path.join(root, 'topology/local-overlays/development.json'),
      JSON.stringify({ schemaVersion: 1, ports: {} }),
    );
    // Match spawnNodeScript's native Node invocation and workspace context.
    // No workers are needed to prove that the installed implementation loads:
    // an invalid topology must reach the proof's own validation error.
    const result = spawnSync(process.execPath, [target], {
      cwd: root,
      env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: root },
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /Invalid topology\/reference-topology\.json/u);
    assert.doesNotMatch(
      output,
      /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|ERR_MODULE_NOT_FOUND|SyntaxError/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the installed workerd proof reads the declared runtime port environment', () => {
  const { root, installedPackage } = createInstalledFixture();
  try {
    const command = generatedToolingCommands.find(
      entry => entry.id === 'cloudflareSsrProof',
    );
    assert.ok(command?.templatePath);
    const target = installTemplate(installedPackage, command.templatePath);
    const dependencies = path.join(installedPackage, 'node_modules');
    fs.mkdirSync(dependencies);
    fs.symlinkSync(
      path.dirname(require.resolve('miniflare/package.json')),
      path.join(dependencies, 'miniflare'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const topologyPath = path.join(root, 'topology/reference-topology.json');
    const overlayPath = path.join(
      root,
      'topology/local-overlays/development.json',
    );
    const wranglerPath = path.join(root, 'apps/shell/.output/wrangler.json');
    for (const filePath of [topologyPath, overlayPath, wranglerPath]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(
      topologyPath,
      JSON.stringify({
        schemaVersion: 1,
        shell: {
          id: 'shell',
          kind: 'shell',
          path: 'apps/shell',
          portEnv: 'SHELL_PORT',
        },
        verticals: [],
      }),
    );
    fs.writeFileSync(overlayPath, JSON.stringify({ ports: { shell: 3020 } }));
    fs.writeFileSync(wranglerPath, JSON.stringify({ name: 'shell' }));
    const result = spawnSync(process.execPath, [target], {
      cwd: root,
      env: {
        ...process.env,
        ULTRAMODERN_WORKSPACE_ROOT: root,
        SHELL_PORT: '65536',
      },
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 1);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /shell has an invalid local proof port from SHELL_PORT/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
