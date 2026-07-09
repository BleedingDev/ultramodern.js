import assert from 'node:assert/strict';
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
  const version = '3.5.0-ultramodern.43';
  const projectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-compact-proof-'),
  );

  try {
    writeJson(path.join(projectDir, '.modernjs/ultramodern.json'), {
      generator: {
        package: '@modern-js/create',
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
        '@modern-js/create': `npm:@bleedingdev/modern-js-create@${version}`,
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

    assert.doesNotThrow(() =>
      assertGeneratedCohort(projectDir, version, {
        expectedTemplateVersion: version,
        workspaceManifest: true,
      }),
    );
  } finally {
    fs.rmSync(projectDir, { force: true, recursive: true });
  }
});
