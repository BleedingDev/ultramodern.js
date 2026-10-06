import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createMicroVerticalReleaseEnvelope } from '@modern-js/app-tools-extensions/release-envelope';
import { reactReleaseUi } from '../../../solutions/app-tools-extensions/tests/renderer-release-fixture';
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
          cloudflare: { routes: { ssr: '/en' } },
        },
        verticals: [
          {
            id: 'party',
            kind: 'vertical',
            path: 'verticals/party',
            surfaceProfile: 'api-only',
          },
        ],
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

async function createWorkerdEnvelopeFixture(
  profile: 'ui-only' | 'full-stack' | 'api-only' = 'full-stack',
) {
  const { root, installedPackage } = createInstalledFixture();
  try {
    const target = installTemplate(
      installedPackage,
      'templates/workspace-scripts/proof-workerd-ssr.mjs',
    );
    fs.mkdirSync(path.join(installedPackage, 'node_modules'));
    fs.symlinkSync(
      path.dirname(require.resolve('miniflare/package.json')),
      path.join(installedPackage, 'node_modules/miniflare'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const sdkRoot = path.resolve(
      __dirname,
      '../../../solutions/ultramodern-app-tools',
    );
    const apps = [
      { id: 'shell', kind: 'shell', profile: 'ui-only' as const },
      { id: 'inventory', kind: 'vertical', profile },
    ];
    const envelopes = new Map<
      string,
      Awaited<ReturnType<typeof createMicroVerticalReleaseEnvelope>>
    >();
    for (const app of apps) {
      const appRoot = path.join(root, 'apps', app.id);
      const outputRoot = path.join(appRoot, '.output');
      fs.mkdirSync(path.join(appRoot, 'node_modules/@modern-js'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(appRoot, 'package.json'),
        JSON.stringify({
          name: `@test/${app.id}`,
          dependencies: { '@modern-js/ultramodern-app-tools': '3.8.3' },
        }),
      );
      // The copied public template resolves the real built SDK and its
      // declared public envelope dependency from this ordinary app slot.
      fs.symlinkSync(
        sdkRoot,
        path.join(appRoot, 'node_modules/@modern-js/ultramodern-app-tools'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const hasUi = app.profile !== 'api-only';
      const hasApi = app.profile !== 'ui-only';
      const files: Record<string, string> = {
        'server/index.mjs': 'export default {};',
        ...(hasUi ? { 'public/client.js': 'globalThis.ui = true;' } : {}),
        ...(hasApi
          ? {
              'worker/__modern_bff_effect.js': 'export const api = true;',
              'public/backend-mf-manifest.json': '{"name":"inventory"}',
              'public/backendRemoteEntry.cjs': 'module.exports = {};',
            }
          : {}),
      };
      for (const [logicalPath, bytes] of Object.entries(files)) {
        const absolutePath = path.join(outputRoot, logicalPath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, bytes);
      }
      fs.writeFileSync(
        path.join(outputRoot, 'wrangler.json'),
        JSON.stringify({
          name: app.id === 'shell' ? 'shell' : '',
          main: 'server/index.mjs',
        }),
      );
      const envelope = await createMicroVerticalReleaseEnvelope({
        artifactRoot: outputRoot,
        target: 'cloudflare',
        identity: {
          unitId: `test/${app.id}`,
          buildMarker: `${app.id}-build`,
          sourceRevision: 'a'.repeat(40),
          releaseVersion: '1.0.0',
        },
        ...(hasUi ? { ui: reactReleaseUi(`${app.id}-build`, app.id) } : {}),
        artifacts: Object.keys(files).map(logicalPath => ({
          logicalPath,
          runtime:
            logicalPath === 'worker/__modern_bff_effect.js'
              ? 'workerd-effect'
              : logicalPath.endsWith('backend-mf-manifest.json')
                ? 'module-federation-manifest'
                : logicalPath.endsWith('.cjs')
                  ? 'commonjs-module'
                  : logicalPath.startsWith('public/')
                    ? 'browser'
                    : 'workerd',
        })),
        surfaces: {
          uiClient: hasUi ? ['public/client.js'] : [],
          ssr: hasUi ? ['server/index.mjs'] : [],
          apiBackend: hasApi ? ['worker/__modern_bff_effect.js'] : [],
          ...(hasApi
            ? {
                backendFederation: {
                  manifest: 'public/backend-mf-manifest.json',
                  container: 'public/backendRemoteEntry.cjs',
                },
              }
            : {}),
        },
      });
      envelopes.set(app.id, envelope);
      fs.mkdirSync(path.join(outputRoot, 'release'));
      fs.writeFileSync(
        path.join(outputRoot, 'release/microvertical-release-envelope.json'),
        JSON.stringify(envelope),
      );
    }
    fs.mkdirSync(path.join(root, 'topology/local-overlays'), {
      recursive: true,
    });
    const topology = {
      schemaVersion: 1,
      shell: {
        id: 'shell',
        kind: 'shell',
        path: 'apps/shell',
        portEnv: 'SHELL_PORT',
        surfaceProfile: 'ui-only',
        deliveryUnit: { unitId: 'test/shell' },
        verticalRefs: profile === 'api-only' ? [] : ['inventory'],
      },
      verticals: [
        {
          id: 'inventory',
          kind: 'vertical',
          path: 'apps/inventory',
          portEnv: 'INVENTORY_PORT',
          surfaceProfile: profile,
          deliveryUnit: { unitId: 'test/inventory' },
        },
      ],
    };
    const topologyPath = path.join(root, 'topology/reference-topology.json');
    fs.writeFileSync(topologyPath, JSON.stringify(topology));
    fs.writeFileSync(
      path.join(root, 'topology/local-overlays/development.json'),
      JSON.stringify({ ports: { shell: 3020, inventory: 3021 } }),
    );
    const run = () => {
      const result = spawnSync(process.execPath, [target], {
        cwd: root,
        env: {
          ...process.env,
          ULTRAMODERN_WORKSPACE_ROOT: root,
          SHELL_PORT: '3020',
          INVENTORY_PORT: '3021',
        },
        encoding: 'utf8',
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 1);
      // Stop at the native worker-name preflight, before any Miniflare VM.
      assert.equal(
        fs.existsSync(
          path.join(
            root,
            '.codex/reports/cloudflare-workerd-ssr/composition-proof.json',
          ),
        ),
        false,
      );
      return `${result.stdout}${result.stderr}`;
    };
    return { root, topology, topologyPath, envelopes, run };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

for (const profile of ['ui-only', 'full-stack', 'api-only'] as const) {
  test(`installed workerd proof authenticates current schema 5 ${profile} envelopes before VM creation`, async () => {
    const fixture = await createWorkerdEnvelopeFixture(profile);
    try {
      assert.match(
        fixture.run(),
        /inventory wrangler output must define a worker name/u,
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test('installed workerd proof rejects schema 3 and changed UI-only artifact bytes', async () => {
  const fixture = await createWorkerdEnvelopeFixture('ui-only');
  try {
    const outputRoot = path.join(fixture.root, 'apps/shell/.output');
    const envelopePath = path.join(
      outputRoot,
      'release/microvertical-release-envelope.json',
    );
    const envelope = fixture.envelopes.get('shell')!;
    fs.writeFileSync(
      envelopePath,
      JSON.stringify({ ...envelope, schemaVersion: 3 }),
    );
    assert.match(fixture.run(), /envelope.schemaVersion must be 5/u);
    fs.writeFileSync(envelopePath, JSON.stringify(envelope));
    fs.appendFileSync(
      path.join(outputRoot, 'public/client.js'),
      '\n// changed',
    );
    assert.match(
      fixture.run(),
      /Artifact "public\/client.js" digest does not match/u,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('installed workerd proof rejects an unbound UI-only selected worker module', async () => {
  const fixture = await createWorkerdEnvelopeFixture('ui-only');
  try {
    const workerRoot = path.join(fixture.root, 'apps/shell/.output/worker');
    fs.mkdirSync(workerRoot);
    fs.writeFileSync(
      path.join(workerRoot, 'undeclared.js'),
      'export const extra = true;',
    );
    assert.match(
      fixture.run(),
      /shell selected module worker\/undeclared.js is not envelope-bound/u,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

for (const profile of ['ui-only', 'full-stack'] as const) {
  test(`installed workerd proof rejects a ${profile} declaration with the opposite API surface`, async () => {
    const fixture = await createWorkerdEnvelopeFixture(profile);
    try {
      fixture.topology.verticals[0].surfaceProfile =
        profile === 'ui-only' ? 'full-stack' : 'ui-only';
      fs.writeFileSync(fixture.topologyPath, JSON.stringify(fixture.topology));
      assert.match(
        fixture.run(),
        /inventory executed envelope surfaces differ from its declared application profile/u,
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}
