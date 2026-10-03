import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  createVerticalDescriptor,
  sharedPackages,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';
import {
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
} from '../src/ultramodern-workspace/module-federation/reexport-module';
import {
  createAppTsConfig,
  createRootTsConfig,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from '../src/ultramodern-workspace/tsconfigs';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';
import {
  createReactBuildFixtureApp,
  linkBuiltBackendFederationContracts,
} from './helpers/build-module';
import { runStableTypeScript } from './helpers/stable-typescript';

const require = createRequire(import.meta.url);
const buildInput = 'shared/ultramodern-build.json';
const apps: WorkspaceApp[] = (
  [
    shellApp,
    createVerticalDescriptor('catalog', 3101),
    {
      ...createVerticalDescriptor('orders', 3102),
      surfaceProfile: 'api-only',
    },
    {
      ...createVerticalDescriptor('nested', 3103),
      directory: 'domains/commerce/apps/nested',
    },
  ] satisfies WorkspaceApp[]
).map(app => createReactBuildFixtureApp('build-input', app));

test('generated composite projects compile their actual build modules and JSON artifacts', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-tsconfig-build-input-'),
  );
  const write = (relativePath: string, source: string) => {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  };
  const writeJson = (relativePath: string, value: unknown) =>
    write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  try {
    writeJson('tsconfig.base.json', createTsConfigBase());
    writeJson('tsconfig.json', createRootTsConfig(apps));
    for (const shared of sharedPackages) {
      writeJson(
        `${shared.directory}/tsconfig.json`,
        createSharedPackageTsConfig(shared.directory),
      );
      write(`${shared.directory}/src/index.ts`, 'export {};\n');
    }
    linkBuiltBackendFederationContracts(path.join(root, 'node_modules'));
    const nodeTypesLink = path.join(root, 'node_modules/@types/node');
    fs.mkdirSync(path.dirname(nodeTypesLink), { recursive: true });
    fs.symlinkSync(
      path.dirname(require.resolve('@types/node/package.json')),
      nodeTypesLink,
      'dir',
    );
    for (const app of apps) {
      writeJson(`${app.directory}/package.json`, { type: 'module' });
      write(
        `${app.directory}/shared/ultramodern-build.ts`,
        createUltramodernBuildModule('build-input', app),
      );
      write(
        `${app.directory}/${buildInput}`,
        createUltramodernBuildArtifactJson('build-input', app),
      );
      writeJson(`${app.directory}/tsconfig.json`, createAppTsConfig(app));
    }
    const current = runStableTypeScript(
      ['--build', '--force', '--pretty', 'false'],
      root,
    );
    assert.equal(current.status, 0, current.output);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
