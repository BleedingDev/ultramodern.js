import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import {
  assertReleaseCohortPackageSource,
  parseUltramodernReleaseCohort,
} from '../src/ultramodern-release-cohort';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';

function cohort() {
  return parseUltramodernReleaseCohort({
    aliases: { '@modern-js/runtime': '@bleedingdev/modern-js-runtime' },
    packages: [
      {
        sourceName: '@modern-js/runtime',
        targetName: '@bleedingdev/modern-js-runtime',
        version: '3.9.0',
      },
    ],
    release: { tag: 'latest', version: '3.9.0' },
    schema: 'bleedingdev.ultramodern.release-cohort',
    schemaVersion: 1,
    source: { commit: 'a'.repeat(40), repository: 'https://example.test/repo' },
  });
}

test('local source generation uses native workspace requests without copied release state', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-native-source-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    const policy = yaml.load(
      fs.readFileSync(path.join(workspaceDir, 'pnpm-workspace.yaml'), 'utf8'),
    ) as Record<string, any>;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'),
    );
    assert.equal(
      manifest.devDependencies['@modern-js/ultramodern-create'],
      'workspace:*',
    );
    assert.equal(
      (policy.minimumReleaseAgeExclude ?? []).some((selector: string) =>
        selector.startsWith('@bleedingdev/modern-js-'),
      ),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, '.modernjs/ultramodern.json')),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, '.modernjs/release-cohort.json')),
      false,
    );
    assert.equal(fs.existsSync(path.join(workspaceDir, 'patches')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('installed producer cohort rejects wrong release and alias identity', () => {
  const expected = cohort();
  assert.doesNotThrow(() =>
    assertReleaseCohortPackageSource(expected, {
      strategy: 'install',
      modernPackageVersion: '3.9.0',
      aliasScope: 'bleedingdev',
      aliasPackageNamePrefix: 'modern-js-',
    }),
  );
  assert.throws(
    () =>
      assertReleaseCohortPackageSource(expected, {
        strategy: 'install',
        modernPackageVersion: '3.8.9',
        aliasScope: 'bleedingdev',
        aliasPackageNamePrefix: 'modern-js-',
      }),
    /does not match authenticated release cohort/u,
  );
  assert.throws(
    () =>
      assertReleaseCohortPackageSource(expected, {
        strategy: 'install',
        modernPackageVersion: '3.9.0',
        aliasScope: 'untrusted',
        aliasPackageNamePrefix: 'modern-js-',
      }),
    /aliases rebind/u,
  );
});

test('local source generation rejects an explicit install request', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-install-source-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    assert.throws(
      () =>
        generateUltramodernWorkspace({
          targetDir: workspaceDir,
          packageName: 'workspace',
          modernVersion: '3.2.1',
          packageSource: { strategy: 'install', modernPackageVersion: '3.2.1' },
        }),
      /local @modern-js\/ultramodern-create source checkout cannot satisfy an explicit install/u,
    );
    assert.equal(fs.existsSync(workspaceDir), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
