import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCandidateRendererProfile } from '@modern-js/ultramodern-app-tools';
import { resolveRendererGenerationAdapter } from '../src/ultramodern-workspace/renderer-generations';
import { getRendererGenerationProfile } from '../src/ultramodern-workspace/renderer-profile';
import { assertAuthoredRendererDependencyPins } from '../src/ultramodern-workspace/validation/renderer';
import { readRendererFrameworkPackageEvidence } from '../src/ultramodern-workspace/validation/renderer-framework-evidence';

const producer = rstest.hoisted(() => ({ root: '' }));

rstest.mock('../src/ultramodern-workspace/fs-io', () => {
  const actual = rstest.requireActual<
    typeof import('../src/ultramodern-workspace/fs-io')
  >('../src/ultramodern-workspace/fs-io');
  return {
    ...actual,
    get createPackageRoot() {
      return producer.root;
    },
  };
});

const releaseVersion = '3.9.0-ultramodern.2026100301';
let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-renderer-cohort-'));
  producer.root = path.join(tempRoot, 'packages/toolkit/ultramodern-create');
  fs.mkdirSync(producer.root, { recursive: true });
  const packages = [
    'renderer-octane',
    'renderer-solid',
    'ultramodern-create',
  ].map(name => ({
    sourceName: `@modern-js/${name}`,
    targetName: `@bleedingdev/modern-js-${name}`,
    version: releaseVersion,
  }));
  fs.writeFileSync(
    path.join(producer.root, 'release-cohort.json'),
    JSON.stringify({
      aliases: Object.fromEntries(
        packages.map(item => [item.sourceName, item.targetName]),
      ),
      packages,
      release: { tag: 'latest', version: releaseVersion },
      schema: 'bleedingdev.ultramodern.release-cohort',
      schemaVersion: 1,
      source: {
        commit: 'a'.repeat(40),
        repository: 'https://example.test/repo',
      },
    }),
  );
  fs.writeFileSync(
    path.join(producer.root, 'package.json'),
    JSON.stringify({
      name: '@bleedingdev/modern-js-ultramodern-create',
      version: releaseVersion,
    }),
  );
});

afterEach(() => {
  rstest.restoreAllMocks();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('native release profiles use authenticated framework versions before generation', () => {
  for (const renderer of ['solid', 'octane'] as const) {
    const name = `@modern-js/renderer-${renderer}`;
    const candidate = resolveCandidateRendererProfile(renderer);
    assert.notEqual(candidate.dependencies[name], releaseVersion);
    const adapter = resolveRendererGenerationAdapter(renderer);
    const createProfile = rstest.spyOn(adapter, 'createProfile');
    const generation = getRendererGenerationProfile(renderer);
    const selected = createProfile.mock.calls.at(-1)![0];
    assert.equal(selected.dependencies[name], releaseVersion);
    assert.deepEqual(generation.profile.compiler, candidate.compiler);
    assert.deepEqual(generation.profile.hydration, candidate.hydration);
    assert.equal(
      generation.profile.router.coreVersion,
      candidate.router.coreVersion,
    );
    if (renderer === 'solid') {
      assert.equal(generation.profile.router.version, releaseVersion);
      assert.equal(selected.router.version, selected.dependencies[name]);
    } else {
      assert.deepEqual(generation.profile.router, candidate.router);
    }
    assert.deepEqual(resolveCandidateRendererProfile(renderer), candidate);
    assert.equal(
      readRendererFrameworkPackageEvidence(name).kind,
      'release-cohort',
    );
    assert.doesNotThrow(() =>
      assertAuthoredRendererDependencyPins(
        {
          name: `@fixture/${renderer}`,
          dependencies: {
            ...generation.dependencies,
            [name]: 'catalog:ultramodern',
          },
          devDependencies: generation.devDependencies,
        },
        generation,
        {
          catalogs: {
            ultramodern: {
              [name]: `npm:@bleedingdev/modern-js-renderer-${renderer}@${releaseVersion}`,
            },
          },
        },
      ),
    );
  }
});

test('release profile selection retains authored version and alias rejections', () => {
  const generation = getRendererGenerationProfile('solid');
  const name = generation.profile.router.name;
  for (const request of [
    '3.8.3',
    `npm:@bleedingdev/modern-js-renderer-solid@3.8.3`,
    `npm:@unverified/renderer-solid@${releaseVersion}`,
    'workspace:*',
  ]) {
    assert.throws(
      () =>
        assertAuthoredRendererDependencyPins(
          {
            name: '@fixture/solid',
            dependencies: { [name]: 'catalog:ultramodern' },
          },
          generation,
          { catalogs: { ultramodern: { [name]: request } } },
        ),
      /disagrees with the authenticated producer package/u,
    );
  }
  assert.throws(
    () =>
      assertAuthoredRendererDependencyPins(
        {
          name: '@fixture/solid',
          devDependencies: {
            [generation.profile.compiler.name]: releaseVersion,
          },
        },
        generation,
      ),
    /disagrees with the selected pin/u,
  );
  assert.throws(
    () =>
      assertAuthoredRendererDependencyPins(
        {
          name: '@fixture/solid',
          dependencies: {
            [name]: `npm:@bleedingdev/modern-js-renderer-solid@${releaseVersion}`,
          },
        },
        {
          ...generation,
          profile: {
            ...generation.profile,
            router: { ...generation.profile.router, version: '0.0.0' },
          },
        },
      ),
    /disagrees with producer cohort evidence/u,
  );
});

test('native release profiles reject evidence from a different create producer', () => {
  fs.writeFileSync(
    path.join(producer.root, 'package.json'),
    JSON.stringify({
      name: '@bleedingdev/modern-js-ultramodern-create',
      version: '3.8.3',
    }),
  );
  assert.throws(
    () => getRendererGenerationProfile('solid'),
    /authenticated release cohort disagrees with the actual create producer/u,
  );
});

test('native source profiles retain source pins and reject source version drift', () => {
  fs.rmSync(path.join(producer.root, 'release-cohort.json'));
  fs.mkdirSync(path.join(producer.root, 'src'));
  fs.writeFileSync(
    path.join(tempRoot, 'package.json'),
    JSON.stringify({ name: 'modern-js-monorepo', private: true }),
  );
  fs.writeFileSync(
    path.join(tempRoot, 'pnpm-workspace.yaml'),
    'packages: []\n',
  );
  const candidate = resolveCandidateRendererProfile('solid');
  const name = candidate.router.name;
  const memberRoot = path.join(tempRoot, 'packages/runtime/renderer-solid');
  fs.mkdirSync(memberRoot, { recursive: true });
  const producerManifest = {
    name: '@modern-js/ultramodern-create',
    version: candidate.router.version,
  };
  const memberManifest = { name, version: candidate.router.version };
  fs.writeFileSync(
    path.join(producer.root, 'package.json'),
    JSON.stringify(producerManifest),
  );
  fs.writeFileSync(
    path.join(memberRoot, 'package.json'),
    JSON.stringify(memberManifest),
  );
  const generation = getRendererGenerationProfile('solid');
  assert.deepEqual(generation.profile.router, candidate.router);
  assert.equal(
    readRendererFrameworkPackageEvidence(name).kind,
    'source-checkout',
  );
  const manifest = {
    name: '@fixture/solid',
    dependencies: { [name]: 'workspace:*' },
  };
  assert.doesNotThrow(() =>
    assertAuthoredRendererDependencyPins(manifest, generation),
  );
  fs.writeFileSync(
    path.join(producer.root, 'package.json'),
    JSON.stringify({ ...producerManifest, version: '0.0.0' }),
  );
  fs.writeFileSync(
    path.join(memberRoot, 'package.json'),
    JSON.stringify({ ...memberManifest, version: '0.0.0' }),
  );
  assert.throws(
    () =>
      assertAuthoredRendererDependencyPins(
        manifest,
        getRendererGenerationProfile('solid'),
      ),
    /disagrees with producer cohort evidence/u,
  );
});

test('React generation keeps its selected profile without native framework evidence', () => {
  fs.rmSync(path.join(producer.root, 'release-cohort.json'));
  const candidate = resolveCandidateRendererProfile('react');
  const generation = getRendererGenerationProfile('react');
  assert.deepEqual(generation.profile.compiler, candidate.compiler);
  assert.deepEqual(generation.profile.hydration, candidate.hydration);
  assert.deepEqual(generation.profile.router, candidate.router);
});
