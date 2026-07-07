import fs from 'node:fs';
import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import { assert, assertProof, assertString, isObject } from './assertions.mjs';

const { readJsonFile } = fsKit;

const dependencyBlockNames = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

const requiredCreateRuntimeDependencies = [
  '@modern-js/codesmith',
  '@modern-js/i18n-utils',
  'oxfmt',
  'ultracite',
];

const requiredCreatePublishedPaths = [
  'bin/run.js',
  'dist/cjs/index.cjs',
  'dist/cjs/ultramodern-workspace/codesmith.cjs',
  'dist/cjs/ultramodern-workspace/public-api.cjs',
  'dist/esm-node/index.js',
  'dist/esm-node/ultramodern-workspace/codesmith.js',
  'dist/esm-node/ultramodern-workspace/public-api.js',
  'dist/types/index.d.ts',
  'dist/types/ultramodern-workspace/codesmith.d.ts',
  'dist/types/ultramodern-workspace/public-api.d.ts',
  'template-workspace',
  'template-workspace/.agents/agent-reference-repos.json',
  'template-workspace/.codex/rstackjs-agent-skills-LICENSE',
  'template-workspace/.codex/skills-lock.json',
  'template-workspace/.codex/hooks.json',
  'template-workspace/.github/renovate.json',
  'template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
  'template-workspace/.gitignore.handlebars',
  'template-workspace/.mise.toml.handlebars',
  'templates',
];

const publicCreateExportSubpaths = [
  '.',
  './ultramodern-workspace',
  './ultramodern-workspace/codesmith',
];

function scopedName(name) {
  assertString(name, 'package name');
  return name.split('/').at(-1);
}

function expectedTargetName(sourceName, manifest) {
  return `@${manifest.scope}/${manifest.prefix}${scopedName(sourceName)}`;
}

function collectSourcePackageIndex(repoRoot) {
  const packagesDir = path.join(repoRoot, 'packages');
  const packages = new Map();

  function visit(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') {
          visit(entryPath);
        }
        continue;
      }

      if (entry.name !== 'package.json') {
        continue;
      }

      const packageJson = readJsonFile(entryPath);
      if (packageJson.name?.startsWith('@modern-js/')) {
        packages.set(packageJson.name, {
          packageJson,
          packageJsonPath: entryPath,
          packageDir: path.dirname(entryPath),
        });
      }
    }
  }

  visit(packagesDir);
  return packages;
}

function validateNoWorkspaceProtocol(packageJson, packageName) {
  for (const blockName of dependencyBlockNames) {
    const block = packageJson[blockName];
    if (!isObject(block)) {
      continue;
    }

    for (const [dependencyName, specifier] of Object.entries(block)) {
      assert(
        typeof specifier !== 'string' || !specifier.startsWith('workspace:'),
        `${packageName} ${blockName}.${dependencyName} still uses ${specifier}`,
      );
    }
  }
}

function validateInternalDependencyResolution({
  manifest,
  packageJson,
  packageName,
}) {
  const checks = [];

  for (const blockName of dependencyBlockNames) {
    const block = packageJson[blockName];
    if (!isObject(block)) {
      continue;
    }

    for (const [dependencyName, specifier] of Object.entries(block)) {
      if (!dependencyName.startsWith('@modern-js/')) {
        continue;
      }

      const hasAlias = Object.prototype.hasOwnProperty.call(
        manifest.aliases,
        dependencyName,
      );
      const targetName = manifest.aliases[dependencyName];
      if (!hasAlias) {
        assert(
          typeof specifier !== 'string' || !specifier.startsWith('workspace:'),
          `${packageName} ${blockName}.${dependencyName} has no alias metadata and still uses ${specifier}`,
        );
        checks.push({
          blockName,
          dependencyName,
          specifier,
          resolution: 'external-registry',
        });
        continue;
      }

      assertString(
        targetName,
        `${packageName} ${blockName}.${dependencyName} has no alias metadata`,
      );

      if (blockName === 'peerDependencies') {
        assert(
          specifier === manifest.dependencyVersion,
          `${packageName} ${blockName}.${dependencyName} must use ${manifest.dependencyVersion}, found ${specifier}`,
        );
      } else {
        const expectedSpecifier = `npm:${targetName}@${manifest.dependencyVersion}`;
        assert(
          specifier === expectedSpecifier,
          `${packageName} ${blockName}.${dependencyName} must resolve to staged cohort ${expectedSpecifier}, found ${specifier}`,
        );
      }

      checks.push({
        blockName,
        dependencyName,
        specifier,
        resolution: 'staged-cohort',
      });
    }
  }

  return checks;
}

function validateCreateRuntimeDependencies(
  packageJson,
  packageName,
  internalChecks,
  manifest,
) {
  const checks = [];

  for (const dependencyName of requiredCreateRuntimeDependencies) {
    const specifier = packageJson.dependencies?.[dependencyName];
    assertString(
      specifier,
      `${packageName} dependencies.${dependencyName} is required because create imports it at runtime`,
    );
    assert(
      packageJson.devDependencies?.[dependencyName] === undefined,
      `${packageName} devDependencies.${dependencyName} must be a runtime dependency`,
    );
    if (
      Object.prototype.hasOwnProperty.call(manifest.aliases, dependencyName)
    ) {
      assert(
        internalChecks.some(
          check =>
            check.blockName === 'dependencies' &&
            check.dependencyName === dependencyName &&
            check.resolution === 'staged-cohort',
        ),
        `${packageName} dependencies.${dependencyName} must resolve to the staged BleedingDev cohort`,
      );
    }
    checks.push({
      dependencyName,
      specifier,
    });
  }

  return checks;
}

function assertExistingPublishedPath(packageDir, packageName, relativePath) {
  const fullPath = path.join(packageDir, relativePath);
  assertProof(
    fs.existsSync(fullPath),
    'template/package files',
    `${packageName} staged package is missing required published path: ${relativePath}`,
  );
}

function validateCreatePublishedPaths(packageDir, packageName) {
  for (const relativePath of requiredCreatePublishedPaths) {
    assertExistingPublishedPath(packageDir, packageName, relativePath);
  }

  return {
    requiredPathCount: requiredCreatePublishedPaths.length,
    requiredPaths: requiredCreatePublishedPaths,
  };
}

function validateExportTarget(packageDir, packageName, subpath, exportValue) {
  assertProof(
    isObject(exportValue),
    'export config',
    `${packageName} exports.${subpath} must be an object`,
  );
  assertString(exportValue.types, `${packageName} exports.${subpath}.types`);
  assertExistingPublishedPath(
    packageDir,
    packageName,
    exportValue.types.replace(/^\.\//, ''),
  );

  assertProof(
    isObject(exportValue.node),
    'export config',
    `${packageName} exports.${subpath}.node must be an object`,
  );
  for (const condition of ['import', 'require']) {
    assertString(
      exportValue.node[condition],
      `${packageName} exports.${subpath}.node.${condition}`,
    );
    assertExistingPublishedPath(
      packageDir,
      packageName,
      exportValue.node[condition].replace(/^\.\//, ''),
    );
  }
}

function validateCreatePublicExports(
  packageDir,
  packageJson,
  sourcePackageJson,
  packageName,
) {
  assertProof(
    isObject(packageJson.exports),
    'export config',
    `${packageName} exports must be an object`,
  );
  assertProof(
    isObject(sourcePackageJson.publishConfig?.exports),
    'export config',
    `${packageName} source publishConfig.exports must be an object`,
  );

  const runtimeExportKeys = Object.keys(packageJson.exports).sort();
  const publishExportKeys = Object.keys(
    sourcePackageJson.publishConfig.exports,
  ).sort();
  assertProof(
    JSON.stringify(runtimeExportKeys) === JSON.stringify(publishExportKeys),
    'export config',
    `${packageName} package exports and source publishConfig.exports must expose the same subpaths`,
  );

  for (const subpath of publicCreateExportSubpaths) {
    validateExportTarget(
      packageDir,
      packageName,
      subpath,
      packageJson.exports[subpath],
    );
    validateExportTarget(
      packageDir,
      packageName,
      subpath,
      sourcePackageJson.publishConfig.exports[subpath],
    );
  }

  return {
    publicSubpaths: publicCreateExportSubpaths,
  };
}

export {
  collectSourcePackageIndex,
  expectedTargetName,
  validateCreatePublicExports,
  validateCreatePublishedPaths,
  validateCreateRuntimeDependencies,
  validateInternalDependencyResolution,
  validateNoWorkspaceProtocol,
};
