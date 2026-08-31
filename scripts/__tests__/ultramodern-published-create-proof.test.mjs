import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertGeneratedCohort } from '../ultramodern-production-readiness/published-create-proof/package-cohort.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('published create proof accepts compact UltraModern metadata', () => {
  const version = '3.5.0-ultramodern.45';
  const releaseManifest = {
    aliases: {
      '@modern-js/app-tools': '@bleedingdev/modern-js-app-tools',
      '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
      '@modern-js/ultramodern-create':
        '@bleedingdev/modern-js-ultramodern-create',
    },
    createPackage: {
      packageJson: {
        ultramodern: {
          frameworkVersion: version,
        },
      },
      sourceName: '@modern-js/ultramodern-create',
      targetName: '@bleedingdev/modern-js-ultramodern-create',
      version,
    },
    packages: [
      {
        sourceName: '@modern-js/app-tools',
        targetName: '@bleedingdev/modern-js-app-tools',
      },
      {
        sourceName: '@modern-js/ultramodern-create',
        targetName: '@bleedingdev/modern-js-ultramodern-create',
      },
      {
        sourceName: '@modern-js/runtime',
        targetName: '@bleedingdev/modern-js-runtime',
      },
    ],
    publishOrder: [
      '@bleedingdev/modern-js-app-tools',
      '@bleedingdev/modern-js-ultramodern-create',
      '@bleedingdev/modern-js-runtime',
    ],
    release: {
      tag: 'latest',
      version,
    },
  };
  const projectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-compact-proof-'),
  );
  const cohortProjection = {
    aliases: releaseManifest.aliases,
    packages: releaseManifest.packages.map(item => ({ ...item, version })),
    release: { tag: 'latest', version },
    schema: 'bleedingdev.ultramodern.release-cohort',
    schemaVersion: 1,
    source: {
      commit: 'a'.repeat(40),
      repository: 'BleedingDev/ultramodern.js',
    },
  };

  try {
    writeJson(path.join(projectDir, '.modernjs/ultramodern.json'), {
      generator: {
        package: '@modern-js/ultramodern-create',
        version,
      },
      packageSource: {
        aliasPackageNamePrefix: 'modern-js-',
        aliasScope: 'bleedingdev',
        modernPackageVersion: version,
        strategy: 'install',
      },
      schemaVersion: 1,
    });
    writeJson(path.join(projectDir, 'package.json'), {
      devDependencies: {
        '@modern-js/ultramodern-create': `npm:@bleedingdev/modern-js-ultramodern-create@${version}`,
      },
      name: 'compact-proof',
      private: true,
    });
    writeJson(path.join(projectDir, 'apps/shell/package.json'), {
      dependencies: {
        '@modern-js/runtime': `npm:@bleedingdev/modern-js-runtime@${version}`,
      },
      devDependencies: {
        '@modern-js/app-tools': `npm:@bleedingdev/modern-js-app-tools@${version}`,
      },
      name: '@compact-proof/shell',
      private: true,
    });
    const cohortProjectionPath = path.join(
      projectDir,
      '.modernjs/release-cohort.json',
    );
    writeJson(cohortProjectionPath, cohortProjection);
    releaseManifest.cohortProjection = {
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(cohortProjectionPath))
        .digest('hex'),
      value: cohortProjection,
    };

    assert.doesNotThrow(() =>
      assertGeneratedCohort(projectDir, releaseManifest),
    );
  } finally {
    fs.rmSync(projectDir, { force: true, recursive: true });
  }
});
