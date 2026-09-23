import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readUltramodernWorkspaceInputs,
  workspaceAppsFromToolingConfig,
} from '../src/ultramodern-tooling/config';

const write = (root: string, relative: string, contents: unknown) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  );
};

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-workspace-'));
  write(root, 'package.json', {
    name: '@farm/root',
    devDependencies: { '@modern-js/ultramodern-create': 'catalog:ultramodern' },
  });
  write(
    root,
    'pnpm-workspace.yaml',
    `packages:
  - apps/*
  - verticals/*
catalogs:
  ultramodern:
    '@modern-js/ultramodern-create': npm:@bleedingdev/ultramodern-create@3.2.1
`,
  );
  write(root, 'apps/custom-shell/package.json', {
    name: '@farm/shell-host',
    dependencies: {
      '@farm/tractor': 'workspace:*',
      '@farm/shared-contracts': 'workspace:*',
      '@external/telemetry': 'workspace:^',
    },
  });
  write(root, 'verticals/tractor/package.json', { name: '@farm/tractor' });
  write(root, 'apps/admin/package.json', { name: '@farm/admin' });
  write(root, 'topology/reference-topology.json', {
    schemaVersion: 1,
    shell: {
      id: 'shell-host',
      kind: 'shell',
      path: 'apps/custom-shell',
      package: '@farm/shell-host',
      verticalRefs: ['tractor'],
      moduleFederation: { name: 'farmHost' },
    },
    verticals: [
      {
        id: 'tractor',
        kind: 'vertical',
        path: 'verticals/tractor',
        package: '@farm/tractor',
        moduleFederation: { name: 'tractorRemote', exposes: ['./Product'] },
      },
    ],
    shells: [
      {
        id: 'shell-admin',
        kind: 'shell',
        path: 'apps/admin',
        package: '@farm/admin',
        verticalRefs: [],
      },
    ],
    sharedPackages: [
      { id: 'shared-contracts', package: '@farm/shared-contracts' },
    ],
  });
  write(root, 'topology/local-overlays/development.json', {
    schemaVersion: 1,
    ports: { 'shell-host': 4400, tractor: 4401, 'shell-admin': 4490 },
  });
  write(
    root,
    'verticals/tractor/module-federation.config.ts',
    `
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
export default createModuleFederationConfig({
  name: 'tractorRemote',
  exposes: { './Product': './src/federation/product.tsx' },
});
`,
  );
  return root;
};

let root: string;
beforeEach(() => {
  root = fixture();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('reads topology, overlay and manifests without retired files', () => {
  const view = readUltramodernWorkspaceInputs(root);
  expect(view.apps.map(app => [app.id, app.directory, app.port])).toEqual([
    ['shell-host', 'apps/custom-shell', 4400],
    ['tractor', 'verticals/tractor', 4401],
    ['shell-admin', 'apps/admin', 4490],
  ]);
  expect(view.primaryShell.verticalRefs).toEqual(['tractor']);
  expect(view.additionalShells.map(app => app.id)).toEqual(['shell-admin']);
  expect(view.verticals[0]?.exposes).toEqual({
    './Product': './src/federation/product.tsx',
  });
  expect(workspaceAppsFromToolingConfig(view.config)[1]?.exposes).toEqual(
    view.verticals[0]?.exposes,
  );
  expect(view.config.topology.apps.map(app => app.package)).toEqual([
    '@farm/shell-host',
    '@farm/tractor',
    '@farm/admin',
  ]);
  expect(view.config.packageSource).toEqual({
    strategy: 'install',
    modernPackageVersion: '3.2.1',
    aliasScope: 'bleedingdev',
    aliasPackageNamePrefix: '',
  });
  expect(view.config.inheritedWorkspaceDependencies).toEqual({
    '@external/telemetry': 'workspace:^',
  });
  expect('bridge' in view.config).toBe(false);
  expect(fs.existsSync(path.join(root, '.modernjs/ultramodern.json'))).toBe(
    false,
  );
  expect(fs.existsSync(path.join(root, '.modernjs/release-cohort.json'))).toBe(
    false,
  );
});

test('accepts a topology without additional shells', () => {
  const topologyFile = path.join(root, 'topology/reference-topology.json');
  const topology = JSON.parse(fs.readFileSync(topologyFile, 'utf8'));
  delete topology.shells;
  write(root, 'topology/reference-topology.json', topology);
  expect(readUltramodernWorkspaceInputs(root).additionalShells).toEqual([]);
});

test('rejects missing canonical inputs and inconsistent package resolution', () => {
  const topologyFile = path.join(root, 'topology/reference-topology.json');
  const topology = JSON.parse(fs.readFileSync(topologyFile, 'utf8'));
  topology.verticals[0].package = '@foreign/tractor';
  write(root, 'topology/reference-topology.json', topology);
  expect(() => readUltramodernWorkspaceInputs(root)).toThrow(
    'package identity',
  );

  write(root, 'topology/reference-topology.json', {
    ...topology,
    verticals: [],
  });
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
  expect(() => readUltramodernWorkspaceInputs(root)).toThrow(
    'Missing @modern-js/ultramodern-create in pnpm catalog',
  );

  fs.unlinkSync(topologyFile);
  expect(() => readUltramodernWorkspaceInputs(root)).toThrow();
});

test('rejects escaped application paths and duplicate overlay ports', () => {
  const topology = JSON.parse(
    fs.readFileSync(
      path.join(root, 'topology/reference-topology.json'),
      'utf8',
    ),
  );
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-outside-'));
  try {
    fs.symlinkSync(outside, path.join(root, 'verticals/escape'));
    topology.verticals[0].path = 'verticals/escape';
    write(root, 'topology/reference-topology.json', topology);
    expect(() => readUltramodernWorkspaceInputs(root)).toThrow(
      'unsafe or duplicate path',
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }

  topology.verticals[0].path = 'verticals/tractor';
  write(root, 'topology/reference-topology.json', topology);
  write(root, 'topology/local-overlays/development.json', {
    schemaVersion: 1,
    ports: { 'shell-host': 4400, tractor: 4400, 'shell-admin': 4490 },
  });
  expect(() => readUltramodernWorkspaceInputs(root)).toThrow(
    'duplicate development port',
  );
});
