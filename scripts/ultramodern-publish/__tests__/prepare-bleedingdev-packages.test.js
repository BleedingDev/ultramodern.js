const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../../..');
const scriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs',
);

const createTemplateRequiredFiles = [
  'template-workspace/.agents/agent-reference-repos.json',
  'template-workspace/.agents/rstackjs-agent-skills-LICENSE',
  'template-workspace/.agents/skills-lock.json',
  'template-workspace/.codex/hooks.json',
  'template-workspace/.github/renovate.json',
  'template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
  'template-workspace/.gitignore.handlebars',
  'template-workspace/.mise.toml.handlebars',
];

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-prepare-publish-'));

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeFile = filePath => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fixture\n');
};

const makeCreateFixture = ({ includeTemplateDotFiles }) => {
  const root = makeTempDir();
  const packageDir = path.join(root, 'packages/create/package');
  writeJson(path.join(packageDir, 'package.json'), {
    name: '@bleedingdev/modern-js-create',
    version: '3.2.0-ultramodern.1',
    publishConfig: {
      access: 'public',
    },
  });
  if (includeTemplateDotFiles) {
    for (const relativePath of createTemplateRequiredFiles) {
      writeFile(path.join(packageDir, relativePath));
    }
  }

  writeJson(path.join(root, 'manifest.json'), {
    schemaVersion: 1,
    generatedAt: '2026-06-04T00:00:00.000Z',
    scope: 'bleedingdev',
    prefix: 'modern-js-',
    version: '3.2.0-ultramodern.1',
    dependencyVersion: '3.2.0-ultramodern.1',
    tag: 'latest',
    aliases: {
      '@modern-js/create': '@bleedingdev/modern-js-create',
    },
    packages: [
      {
        sourceName: '@modern-js/create',
        targetName: '@bleedingdev/modern-js-create',
        version: '3.2.0-ultramodern.1',
        packageDir: path.relative(repoRoot, packageDir),
      },
    ],
  });

  return root;
};

const runPublishExisting = outDir =>
  spawnSync(
    process.execPath,
    [
      scriptPath,
      '--publish-existing',
      '--version',
      '3.2.0-ultramodern.1',
      '--out',
      outDir,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

const makeManifest = () => ({
  schemaVersion: 1,
  generatedAt: '2026-06-04T00:00:00.000Z',
  scope: 'bleedingdev',
  prefix: 'modern-js-',
  version: '3.2.0-ultramodern.1',
  dependencyVersion: '3.2.0-ultramodern.1',
  tag: 'latest',
  aliases: {
    '@modern-js/create': '@bleedingdev/modern-js-create',
    '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
  },
  packages: [
    {
      sourceName: '@modern-js/create',
      targetName: '@bleedingdev/modern-js-create',
      version: '3.2.0-ultramodern.1',
      packageDir: '.modern/bleedingdev-publish/packages/create',
    },
    {
      sourceName: '@modern-js/runtime',
      targetName: '@bleedingdev/modern-js-runtime',
      version: '3.2.0-ultramodern.1',
      packageDir: '.modern/bleedingdev-publish/packages/runtime',
    },
  ],
});

test('publish-existing rejects create packages missing hidden workspace template files', () => {
  const outDir = makeCreateFixture({ includeTemplateDotFiles: false });

  try {
    const result = runPublishExisting(outDir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /@bleedingdev\/modern-js-create staged package is missing required create template file\(s\):/,
    );
    assert.match(
      result.stderr,
      /template-workspace\/\.agents\/skills-lock\.json/,
    );
  } finally {
    removeDir(outDir);
  }
});

test('parseArgs rejects partial publish controls', async () => {
  const { parseArgs } = await import('../prepare-bleedingdev-packages.mjs');

  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.2.0-ultramodern.1',
        '--packages',
        '@modern-js/create',
      ]),
    /--packages is forbidden/,
  );
  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.2.0-ultramodern.1',
        '--dependency-version',
        '3.2.0-ultramodern.0',
      ]),
    /--dependency-version is forbidden/,
  );
  assert.throws(
    () => parseArgs(['--version', '3.2.0-ultramodern.1', '--no-skip-existing']),
    /--no-skip-existing is forbidden/,
  );
});

test('validateFullCohortManifest rejects missing aliases', async () => {
  const { validateFullCohortManifest } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();
  manifest.packages = manifest.packages.filter(
    item => item.sourceName !== '@modern-js/runtime',
  );

  assert.throws(
    () => validateFullCohortManifest(manifest),
    /BleedingDev publish manifest is missing 1 public package/,
  );
});

test('validateRegistryCohort blocks success when any package is absent', async () => {
  const { validateRegistryCohort } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();

  await assert.rejects(
    () =>
      validateRegistryCohort(
        manifest,
        { dryRun: false, tag: 'latest' },
        {
          verifyRegistryDistTag: async () => {},
          verifyRegistryPackage: async packageName => {
            if (packageName === '@bleedingdev/modern-js-runtime') {
              throw new Error('not found');
            }
          },
        },
      ),
    /The latest dist-tag is not coherent for the full cohort/,
  );
});

test('validateRegistryCohort requires every package latest tag to point at the published version', async () => {
  const { validateRegistryCohort } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();

  await assert.rejects(
    () =>
      validateRegistryCohort(
        manifest,
        { dryRun: false, tag: 'latest' },
        {
          verifyRegistryPackage: async () => {},
          verifyRegistryDistTag: async packageName => {
            if (packageName === '@bleedingdev/modern-js-runtime') {
              throw new Error(
                '@bleedingdev/modern-js-runtime dist-tag latest points at 3.2.0-ultramodern.89, expected 3.2.0-ultramodern.1',
              );
            }
          },
        },
      ),
    /dist-tag latest points at 3\.2\.0-ultramodern\.89/,
  );
});

test('orderPublishItems publishes create last so users do not see an incomplete cohort', async () => {
  const { orderPublishItems } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();

  assert.deepEqual(
    orderPublishItems(manifest.packages).map(item => item.sourceName),
    ['@modern-js/runtime', '@modern-js/create'],
  );
});

test('validateRegistryCohort accepts a coherent latest-tagged full cohort', async () => {
  const { validateRegistryCohort } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();

  await validateRegistryCohort(
    manifest,
    { dryRun: false, tag: 'latest' },
    {
      verifyRegistryPackage: async () => {},
      verifyRegistryDistTag: async (_packageName, tag, version) => {
        assert.equal(tag, 'latest');
        assert.equal(version, '3.2.0-ultramodern.1');
      },
    },
  );
});

test('publish-existing accepts create packages with hidden template files before trusted publish check', () => {
  const outDir = makeCreateFixture({ includeTemplateDotFiles: true });

  try {
    const result = runPublishExisting(outDir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Publishing is only allowed from the GitHub Actions trusted publishing workflow/,
    );
    assert.doesNotMatch(result.stderr, /missing required create template/);
  } finally {
    removeDir(outDir);
  }
});
