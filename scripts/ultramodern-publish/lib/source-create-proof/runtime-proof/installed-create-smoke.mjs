import fs from 'node:fs';
import path from 'node:path';
import { assertProof } from '../assertions.mjs';
import { runChecked } from './package-store.mjs';

export function runInstalledCreateSmoke({
  consumerDir,
  createItem,
  installedCreateDir,
  manifest,
}) {
  const env = {
    MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: manifest.dependencyVersion,
  };
  const cliWorkspace = 'cli-proof-workspace';
  runChecked(
    process.execPath,
    [
      path.join(installedCreateDir, 'bin/run.js'),
      cliWorkspace,
      '--ultramodern-package-source',
      'install',
      '--ultramodern-package-version',
      manifest.dependencyVersion,
    ],
    {
      cwd: consumerDir,
      env,
      category: 'package root',
    },
  );
  assertProof(
    fs.existsSync(
      path.join(consumerDir, cliWorkspace, '.modernjs/ultramodern.json'),
    ),
    'generated output',
    'Installed create CLI did not generate compact UltraModern config',
  );

  const packageSpecifier = createItem.targetName;
  const esmProgram = `
    import fs from 'node:fs';
    import path from 'node:path';
    import {
      addUltramodernVertical,
      generateUltramodernWorkspace,
      planUltramodernVertical,
    } from ${JSON.stringify(`${packageSpecifier}/ultramodern-workspace`)};
    import adapter from ${JSON.stringify(`${packageSpecifier}/ultramodern-workspace/codesmith`)};

    if (typeof adapter !== 'function') {
      throw new Error('Expected CodeSmith adapter default export');
    }

    const workspaceRoot = path.join(process.cwd(), 'esm-proof-workspace');
    const workspaceResult = generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'esm-proof-workspace',
      modernVersion: ${JSON.stringify(manifest.dependencyVersion)},
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: ${JSON.stringify(manifest.dependencyVersion)},
      },
    });
    const verticalResult = addUltramodernVertical({
      workspaceRoot,
      name: 'catalog',
      modernVersion: ${JSON.stringify(manifest.dependencyVersion)},
    });
    const plan = planUltramodernVertical({
      workspaceRoot,
      name: 'checkout',
      modernVersion: ${JSON.stringify(manifest.dependencyVersion)},
    });

    if (workspaceResult.operation !== 'workspace') {
      throw new Error('Expected workspace generation result');
    }
    if (
      verticalResult.operation !== 'vertical' ||
      verticalResult.assignedPorts.catalog !== 4101 ||
      verticalResult.apiPrefixes.catalog !== '/catalog-api'
    ) {
      throw new Error('Expected MicroVertical generation result');
    }
    if (plan.dryRun !== true || plan.selectedPort !== 4102) {
      throw new Error('Expected MicroVertical dry-run plan');
    }
    for (const relativePath of [
      '.modernjs/ultramodern.json',
      'apps/shell-super-app/package.json',
      'scripts/check-ultramodern-api-boundaries.mts',
      'verticals/catalog/package.json',
      'verticals/catalog/api/index.ts',
      'verticals/catalog/shared/api.ts',
      'verticals/catalog/src/api/catalog-client.ts',
    ]) {
      if (!fs.existsSync(path.join(workspaceRoot, relativePath))) {
        throw new Error('Missing generated output: ' + relativePath);
      }
    }
    for (const forbiddenPath of [
      'verticals/catalog/api/effect/index.ts',
      'verticals/catalog/shared/effect/api.ts',
      'verticals/catalog/src/effect/catalog-client.ts',
    ]) {
      if (fs.existsSync(path.join(workspaceRoot, forbiddenPath))) {
        throw new Error('Forbidden strict Effect side path exists: ' + forbiddenPath);
      }
    }
  `;
  runChecked(process.execPath, ['--input-type=module', '--eval', esmProgram], {
    cwd: consumerDir,
    env,
    category: 'package root',
  });

  const cjsProgram = `
    const fs = require('node:fs');
    const path = require('node:path');
    const publicApi = require(${JSON.stringify(`${packageSpecifier}/ultramodern-workspace`)});
    const adapterModule = require(${JSON.stringify(`${packageSpecifier}/ultramodern-workspace/codesmith`)});
    const adapter = adapterModule.default || adapterModule;
    if (typeof adapter !== 'function') {
      throw new Error('Expected CodeSmith adapter CJS export');
    }
    const workspaceRoot = path.join(process.cwd(), 'cjs-proof-workspace');
    const result = publicApi.generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'cjs-proof-workspace',
      modernVersion: ${JSON.stringify(manifest.dependencyVersion)},
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: ${JSON.stringify(manifest.dependencyVersion)},
      },
    });
    if (result.operation !== 'workspace') {
      throw new Error('Expected CJS workspace generation result');
    }
    if (!fs.existsSync(path.join(workspaceRoot, 'apps/shell-super-app/package.json'))) {
      throw new Error('Missing CJS generated shell package');
    }
  `;
  runChecked(process.execPath, ['--eval', cjsProgram], {
    cwd: consumerDir,
    env,
    category: 'package root',
  });

  return {
    cliWorkspace,
    esmWorkspace: 'esm-proof-workspace',
    cjsWorkspace: 'cjs-proof-workspace',
    importedSubpaths: [
      `${packageSpecifier}/ultramodern-workspace`,
      `${packageSpecifier}/ultramodern-workspace/codesmith`,
    ],
  };
}
