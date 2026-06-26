import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
};

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv,
  });
}

function read(workspaceDir: string, relativePath: string) {
  return fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
}

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(read(workspaceDir, relativePath));
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf-8',
  );
}

function exists(workspaceDir: string, relativePath: string) {
  return fs.existsSync(path.join(workspaceDir, relativePath));
}

function runGeneratedWorkspaceCheck(workspaceDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mjs'],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
    },
  );
}

function commandOutput(result: ReturnType<typeof runGeneratedWorkspaceCheck>) {
  return `${result.stdout}\n${result.stderr}`;
}

function listFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, entryPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function snapshotWorkspace(workspaceDir: string): Record<string, string> {
  return Object.fromEntries(
    listFiles(workspaceDir).map(relativePath => [
      relativePath,
      read(workspaceDir, relativePath),
    ]),
  );
}

function appById(apps: any[], id: string): any {
  const app = apps.find(candidate => candidate.id === id);
  assert.ok(app, `Expected app ${id}`);
  return app;
}

function assertGeneratedVerticalFiles(workspaceDir: string, id: string) {
  for (const relativePath of [
    `verticals/${id}/api/effect/index.ts`,
    `verticals/${id}/locales/cs/${id}.json`,
    `verticals/${id}/locales/cs/translation.json`,
    `verticals/${id}/locales/en/${id}.json`,
    `verticals/${id}/locales/en/translation.json`,
    `verticals/${id}/shared/effect/api.ts`,
    `verticals/${id}/src/components/${id}-widget.tsx`,
    `verticals/${id}/src/effect/${id}-client.ts`,
    `verticals/${id}/src/federation-entry.tsx`,
    `verticals/${id}/src/routes/[lang]/page.tsx`,
    `verticals/${id}/src/routes/ultramodern-route-metadata.ts`,
  ]) {
    assert.equal(exists(workspaceDir, relativePath), true, relativePath);
  }
}

function assertIntegratedVertical(
  workspaceDir: string,
  id: 'catalog' | 'checkout',
  port: number,
) {
  const scope = 'integration-workspace';
  const packageName = `@${scope}/${id}`;
  const mfName = `vertical${id[0].toUpperCase()}${id.slice(1)}`;
  const manifestUrl = `http://localhost:${port}/mf-manifest.json`;
  const apiUrl = `http://localhost:${port}/${id}-api`;
  const topology = readJson(workspaceDir, 'topology/reference-topology.json');
  const ownership = readJson(workspaceDir, 'topology/ownership.json');
  const overlay = readJson(
    workspaceDir,
    'topology/local-overlays/development.json',
  );
  const contract = readJson(
    workspaceDir,
    '.modernjs/ultramodern-generated-contract.json',
  );
  const shellPackage = readJson(
    workspaceDir,
    'apps/shell-super-app/package.json',
  );
  const verticalPackage = readJson(
    workspaceDir,
    `verticals/${id}/package.json`,
  );
  const topologyEntry = appById(topology.verticals, id);
  const ownershipEntry = appById(ownership.owners, id);
  const contractEntry = appById(contract.apps, id);

  assertGeneratedVerticalFiles(workspaceDir, id);
  assert.deepEqual(topologyEntry.moduleFederation.exposes, [
    './Route',
    './Widget',
  ]);
  assert.equal(topologyEntry.moduleFederation.name, mfName);
  assert.equal(topologyEntry.moduleFederation.manifestUrl, manifestUrl);
  assert.equal(topologyEntry.package, packageName);
  assert.equal(topologyEntry.path, `verticals/${id}`);
  assert.equal(topologyEntry.api.effect.bff.prefix, `/${id}-api`);
  assert.equal(
    topologyEntry.api.effect.serverEntry,
    `verticals/${id}/api/effect/index.ts`,
  );
  assert.equal(ownershipEntry.package, packageName);
  assert.equal(ownershipEntry.path, `verticals/${id}`);
  assert.equal(ownershipEntry.ownership.team, 'super-app-platform');
  assert.equal(overlay.ports[id], port);
  assert.equal(overlay.manifests[id], manifestUrl);
  assert.equal(overlay.apis[id], apiUrl);

  assert.equal(contractEntry.package, packageName);
  assert.equal(contractEntry.path, `verticals/${id}`);
  assert.equal(contractEntry.kind, 'vertical');
  assert.deepEqual(contractEntry.moduleFederation.exposes, [
    './Route',
    './Widget',
  ]);
  assert.equal(contractEntry.moduleFederation.name, mfName);
  assert.equal(contractEntry.effect.prefix, `/${id}-api`);
  assert.equal(contractEntry.i18n.namespace, id);
  assert.equal(contractEntry.styling.tailwind, true);
  assert.equal(
    contractEntry.styling.federation.rootSelector,
    `[data-app-id="${id}"]`,
  );

  assert.equal(verticalPackage.name, packageName);
  assert.equal(
    verticalPackage.type,
    undefined,
    'generated MF vertical app packages must stay CJS-compatible',
  );
  assert.equal(
    verticalPackage.exports['./Route'],
    './src/federation-entry.tsx',
  );
  assert.equal(
    verticalPackage.exports['./Widget'],
    `./src/components/${id}-widget.tsx`,
  );
  assert.equal(
    verticalPackage.exports['./shared/effect/api'],
    './shared/effect/api.ts',
  );
  assert.equal(
    verticalPackage.dependencies['@modern-js/plugin-bff'],
    'npm:@bleedingdev/modern-js-plugin-bff@3.2.0-ultramodern.108',
  );
  assert.equal(shellPackage.dependencies[packageName], 'workspace:*');
  assert.equal(
    shellPackage['zephyr:dependencies'][id],
    `${packageName}@workspace:*`,
  );
}

test('workspace and MicroVertical integration stays coherent across public API and CLI additions', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-integration-'));
  const workspaceDir = path.join(tempRoot, 'integration-workspace');

  try {
    const workspaceResult = generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'integration-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: '3.2.0-ultramodern.108',
      },
    });
    assert.equal(workspaceResult.operation, 'workspace');
    assert.equal(workspaceResult.packageSource.strategy, 'install');

    const publicApiResult = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assert.deepEqual(publicApiResult.assignedPorts, { catalog: 4101 });

    const cliResult = runCli(workspaceDir, ['--vertical-name', 'checkout']);
    assert.equal(cliResult.status, 0, cliResult.stderr);

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    const contract = readJson(
      workspaceDir,
      '.modernjs/ultramodern-generated-contract.json',
    );
    const rootPackage = readJson(workspaceDir, 'package.json');
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    const packageSource = readJson(
      workspaceDir,
      '.modernjs/ultramodern-package-source.json',
    );

    assert.deepEqual(topology.shell.verticalRefs, ['catalog', 'checkout']);
    assert.deepEqual(
      topology.shell.moduleFederation.remotes.map((remote: any) => remote.id),
      ['catalog', 'checkout'],
    );
    assert.deepEqual(Object.keys(overlay.ports).sort(), [
      'catalog',
      'checkout',
      'shell-super-app',
    ]);
    assert.deepEqual(
      contract.apps.map((app: any) => app.id),
      ['shell-super-app', 'catalog', 'checkout'],
    );
    assert.deepEqual(
      appById(contract.apps, 'shell-super-app').moduleFederation.verticalRefs,
      ['catalog', 'checkout'],
    );
    assert.deepEqual(
      appById(contract.apps, 'shell-super-app').moduleFederation.remotes.map(
        (remote: any) => remote.id,
      ),
      ['catalog', 'checkout'],
    );
    assert.equal(rootPackage.modernjs.packageSource.strategy, 'install');
    assert.equal(rootPackage.type, 'module');
    assert.equal(
      shellPackage.type,
      undefined,
      'generated MF shell app package must stay CJS-compatible',
    );
    assert.equal(
      rootPackage.scripts['dev:catalog'],
      'pnpm --filter @integration-workspace/catalog dev',
    );
    assert.equal(
      rootPackage.scripts['dev:checkout'],
      'pnpm --filter @integration-workspace/checkout dev',
    );
    assert.match(rootPackage.scripts.dev, /@integration-workspace\/catalog/);
    assert.match(rootPackage.scripts.dev, /@integration-workspace\/checkout/);
    assert.match(rootPackage.scripts.build, /verticals\/\*/);
    assert.match(rootPackage.scripts.check, /contract:check/);
    assert.equal(packageSource.strategy, 'install');
    assert.equal(
      packageSource.modernPackages.specifier,
      '3.2.0-ultramodern.108',
    );
    assert.equal(
      packageSource.modernPackages.aliases['@modern-js/runtime'],
      '@bleedingdev/modern-js-runtime',
    );
    assert.equal(
      shellPackage.dependencies['@modern-js/runtime'],
      'npm:@bleedingdev/modern-js-runtime@3.2.0-ultramodern.108',
    );

    assertIntegratedVertical(workspaceDir, 'catalog', 4101);
    assertIntegratedVertical(workspaceDir, 'checkout', 4102);
    assert.match(
      read(workspaceDir, 'apps/shell-super-app/src/effect/vertical-clients.ts'),
      /createCheckoutClient/,
    );
    assert.match(
      read(
        workspaceDir,
        'apps/shell-super-app/src/routes/vertical-components.tsx',
      ),
      /checkout\/Widget/,
    );

    const afterTwoVerticals = snapshotWorkspace(workspaceDir);
    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'catalog',
          modernVersion: '3.2.1',
        }),
      /Refusing to overwrite existing path: verticals\/catalog/,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), afterTwoVerticals);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated MicroVertical self-check names corrupted contracts and fix areas', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-self-check-'));

  const scenarios = [
    {
      workspaceName: 'topology-corrupt',
      mutate: (workspaceDir: string) => {
        const topology = readJson(
          workspaceDir,
          'topology/reference-topology.json',
        );
        topology.shell.moduleFederation.remotes[0].manifestUrl =
          'http://localhost:4999/mf-manifest.json';
        writeJson(workspaceDir, 'topology/reference-topology.json', topology);
      },
      expectedContract:
        /MicroVertical contract self-check failed: topology\/reference-topology\.json shell\.moduleFederation\.remotes\./,
      expectedFixArea:
        /Fix area: restore generated shell Module Federation remotes\./,
    },
    {
      workspaceName: 'overlay-corrupt',
      mutate: (workspaceDir: string) => {
        const overlay = readJson(
          workspaceDir,
          'topology/local-overlays/development.json',
        );
        overlay.apis.catalog = 'http://localhost:4101/not-catalog-api';
        writeJson(
          workspaceDir,
          'topology/local-overlays/development.json',
          overlay,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: topology\/local-overlays\/development\.json apis\.catalog\./,
      expectedFixArea: /Fix area: restore generated local Effect API overlay\./,
    },
    {
      workspaceName: 'vertical-file-missing',
      mutate: (workspaceDir: string) => {
        fs.rmSync(
          path.join(workspaceDir, 'verticals/catalog/shared/effect/api.ts'),
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: required files for catalog\. Missing verticals\/catalog\/shared\/effect\/api\.ts\./,
      expectedFixArea:
        /Fix area: restore the generated MicroVertical files or rerun the MicroVertical generator\./,
    },
  ] as const;

  try {
    for (const scenario of scenarios) {
      const workspaceDir = path.join(tempRoot, scenario.workspaceName);
      generateUltramodernWorkspace({
        targetDir: workspaceDir,
        packageName: scenario.workspaceName,
        modernVersion: '3.2.1',
        enableTailwind: true,
        packageSource: {
          strategy: 'install',
          modernPackageVersion: '3.2.0-ultramodern.108',
        },
      });
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name: 'catalog',
        modernVersion: '3.2.1',
      });

      const passingResult = runGeneratedWorkspaceCheck(workspaceDir);
      assert.equal(passingResult.status, 0, commandOutput(passingResult));

      scenario.mutate(workspaceDir);
      const failingResult = runGeneratedWorkspaceCheck(workspaceDir);
      const output = commandOutput(failingResult);
      assert.notEqual(failingResult.status, 0, output);
      assert.match(output, scenario.expectedContract);
      assert.match(output, scenario.expectedFixArea);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workspace package-source strategy and Tailwind-disabled generation remain integrated', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-integration-'));
  const workspaceDir = path.join(tempRoot, 'workspace-source-no-tailwind');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'workspace-source-no-tailwind',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: {
        strategy: 'workspace',
      },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const rootPackage = readJson(workspaceDir, 'package.json');
    const packageSource = readJson(
      workspaceDir,
      '.modernjs/ultramodern-package-source.json',
    );
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    const catalogPackage = readJson(
      workspaceDir,
      'verticals/catalog/package.json',
    );
    const contract = readJson(
      workspaceDir,
      '.modernjs/ultramodern-generated-contract.json',
    );

    assert.equal(rootPackage.modernjs.packageSource.strategy, 'workspace');
    assert.equal(packageSource.strategy, 'workspace');
    assert.equal(packageSource.modernPackages.specifier, 'workspace:*');
    assert.equal(
      shellPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );
    assert.equal(
      catalogPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );
    assert.equal(
      catalogPackage.dependencies['@modern-js/plugin-bff'],
      'workspace:*',
    );
    for (const dependency of [
      'tailwindcss',
      'postcss',
      '@tailwindcss/postcss',
    ]) {
      assert.equal(shellPackage.devDependencies[dependency], undefined);
      assert.equal(catalogPackage.devDependencies[dependency], undefined);
    }
    for (const relativePath of [
      'apps/shell-super-app/postcss.config.mjs',
      'apps/shell-super-app/tailwind.config.ts',
      'verticals/catalog/postcss.config.mjs',
      'verticals/catalog/tailwind.config.ts',
    ]) {
      assert.equal(exists(workspaceDir, relativePath), false, relativePath);
    }
    assert.equal(
      appById(contract.apps, 'shell-super-app').styling.tailwind,
      false,
    );
    assert.equal(appById(contract.apps, 'catalog').styling.tailwind, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
