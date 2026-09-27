import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

// Replays a workspace created on the day its cohort is published: the create
// package runs from node_modules (no src/, shipped release-cohort.json), and
// pnpm's strict 24h gate would reject every cohort package unless the
// workspace exempts exactly those versions.
test('an installed create package exempts exactly its shipped cohort from the release-age gate', () => {
  const packageRoot = path.resolve(__dirname, '..');
  // The installed copy lives under this package's node_modules so Node
  // resolves its dependencies by walking up, with no links to create.
  const installRoot = fs.mkdtempSync(
    path.join(packageRoot, 'node_modules', '.um-installed-cohort-'),
  );
  const installed = path.join(
    installRoot,
    '@bleedingdev/modern-js-ultramodern-create',
  );
  const tempRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-installed-cohort-')),
  );
  try {
    fs.mkdirSync(installed, { recursive: true });
    for (const entry of [
      'package.json',
      'dist',
      'template',
      'template-workspace',
      'templates',
    ]) {
      fs.cpSync(path.join(packageRoot, entry), path.join(installed, entry), {
        recursive: true,
      });
    }
    const version = '3.9.0-ultramodern.17';
    // modern-js-utils is not a catalog entry: it arrives transitively at the
    // same cohort version and must be exempt too.
    const names = ['runtime', 'ultramodern-create', 'utils'];
    fs.writeFileSync(
      path.join(installed, 'release-cohort.json'),
      JSON.stringify({
        aliases: Object.fromEntries(
          names.map(name => [
            `@modern-js/${name}`,
            `@bleedingdev/modern-js-${name}`,
          ]),
        ),
        packages: names.map(name => ({
          sourceName: `@modern-js/${name}`,
          targetName: `@bleedingdev/modern-js-${name}`,
          version,
        })),
        release: { tag: 'latest', version },
        schema: 'bleedingdev.ultramodern.release-cohort',
        schemaVersion: 1,
        source: {
          commit: 'a'.repeat(40),
          repository: 'https://example.test/repo',
        },
      }),
    );
    const generate = (workspace: string, modernPackageVersion: string) =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const { generateUltramodernWorkspace } = await import(process.argv[1]);
generateUltramodernWorkspace(JSON.parse(process.argv[2]));`,
          pathToFileURL(
            path.join(
              installed,
              'dist/esm-node/ultramodern-workspace/public-api.js',
            ),
          ).href,
          JSON.stringify({
            targetDir: path.join(tempRoot, workspace),
            packageName: workspace,
            modernVersion: version,
            generateAgentFiles: false,
            packageSource: { strategy: 'install', modernPackageVersion },
          }),
        ],
        { cwd: tempRoot, encoding: 'utf8' },
      );

    const created = generate('fresh', version);
    assert.equal(created.status, 0, created.stderr);
    const policy = yaml.load(
      fs.readFileSync(path.join(tempRoot, 'fresh/pnpm-workspace.yaml'), 'utf8'),
    ) as Record<string, any>;
    assert.deepEqual(
      policy.minimumReleaseAgeExclude,
      names.map(name => `@bleedingdev/modern-js-${name}@${version}`),
    );
    assert.equal(policy.minimumReleaseAge, 1440);
    assert.equal(policy.minimumReleaseAgeStrict, true);
    assert.equal(
      policy.catalogs.ultramodern['@modern-js/runtime'],
      `npm:@bleedingdev/modern-js-runtime@${version}`,
    );

    // A catalog for another release cannot be authenticated by this package,
    // so it keeps the full 24h gate instead of borrowing this cohort's list.
    const other = generate('other', '3.9.0-ultramodern.16');
    assert.equal(other.status, 0, other.stderr);
    const otherPolicy = yaml.load(
      fs.readFileSync(path.join(tempRoot, 'other/pnpm-workspace.yaml'), 'utf8'),
    ) as Record<string, any>;
    assert.equal(
      otherPolicy.catalogs.ultramodern['@modern-js/runtime'],
      'npm:@bleedingdev/modern-js-runtime@3.9.0-ultramodern.16',
    );
    assert.equal('minimumReleaseAgeExclude' in otherPolicy, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
});
