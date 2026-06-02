const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-source-proof-'));

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const makePackageJson = ({
  dir,
  name,
  version = '1.0.0',
  dependencies,
  ultramodern,
}) => {
  writeJson(path.join(dir, 'package.json'), {
    name,
    version,
    repository: {
      type: 'git',
      url: 'git+https://github.com/BleedingDev/ultramodern.js.git',
    },
    publishConfig: {
      access: 'public',
    },
    ...(dependencies ? { dependencies } : {}),
    ...(ultramodern ? { ultramodern } : {}),
  });
};

const makeFixture = ({
  dependencyVersion = '3.2.0-ultramodern.1',
  includeUtils = true,
  includeCreate = true,
  stagedDependency = 'npm:@bleedingdev/modern-js-utils@3.2.0-ultramodern.1',
  createFrameworkVersion = '3.2.0-ultramodern.1',
} = {}) => {
  const repoRoot = makeTempDir();
  const manifestPath = path.join(
    repoRoot,
    '.modern/bleedingdev-publish/manifest.json',
  );
  const outPath = path.join(
    repoRoot,
    '.modern/prepublish-release-gates/source-create-proof.json',
  );
  const packages = [];

  const aliases = {
    '@modern-js/create': '@bleedingdev/modern-js-create',
    '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
    '@modern-js/utils': '@bleedingdev/modern-js-utils',
  };

  makePackageJson({
    dir: path.join(repoRoot, 'packages/runtime'),
    name: '@modern-js/runtime',
    dependencies: {
      '@modern-js/utils': stagedDependency,
    },
  });
  makePackageJson({
    dir: path.join(repoRoot, '.modern/bleedingdev-publish/packages/runtime'),
    name: '@bleedingdev/modern-js-runtime',
    version: '3.2.0-ultramodern.1',
    dependencies: {
      '@modern-js/utils': stagedDependency,
    },
  });
  packages.push({
    sourceName: '@modern-js/runtime',
    targetName: '@bleedingdev/modern-js-runtime',
    version: '3.2.0-ultramodern.1',
    packageDir: '.modern/bleedingdev-publish/packages/runtime',
  });

  if (includeUtils) {
    makePackageJson({
      dir: path.join(repoRoot, 'packages/utils'),
      name: '@modern-js/utils',
    });
    makePackageJson({
      dir: path.join(repoRoot, '.modern/bleedingdev-publish/packages/utils'),
      name: '@bleedingdev/modern-js-utils',
      version: '3.2.0-ultramodern.1',
    });
    packages.push({
      sourceName: '@modern-js/utils',
      targetName: '@bleedingdev/modern-js-utils',
      version: '3.2.0-ultramodern.1',
      packageDir: '.modern/bleedingdev-publish/packages/utils',
    });
  }

  if (includeCreate) {
    makePackageJson({
      dir: path.join(repoRoot, 'packages/toolkit/create'),
      name: '@modern-js/create',
    });
    makePackageJson({
      dir: path.join(repoRoot, '.modern/bleedingdev-publish/packages/create'),
      name: '@bleedingdev/modern-js-create',
      version: '3.2.0-ultramodern.1',
      ultramodern: {
        frameworkVersion: createFrameworkVersion,
      },
    });
    packages.push({
      sourceName: '@modern-js/create',
      targetName: '@bleedingdev/modern-js-create',
      version: '3.2.0-ultramodern.1',
      packageDir: '.modern/bleedingdev-publish/packages/create',
    });
  }

  writeJson(manifestPath, {
    schemaVersion: 1,
    generatedAt: '2026-06-02T00:00:00.000Z',
    scope: 'bleedingdev',
    prefix: 'modern-js-',
    version: '3.2.0-ultramodern.1',
    dependencyVersion,
    tag: 'ultramodern-canary',
    aliases,
    packages,
  });

  return {
    repoRoot,
    manifestPath,
    outPath,
  };
};

test('validateSourceProof accepts staged local cohort metadata', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture();

  try {
    const proof = validateSourceProof(fixture);

    assert.equal(proof.passed, true);
    assert.equal(proof.cohort.packageCount, 3);
    assert.equal(
      proof.createPackageProof.frameworkVersion,
      '3.2.0-ultramodern.1',
    );
    assert.equal(
      proof.packages.find(item => item.sourceName === '@modern-js/runtime')
        .internalDependencyChecks[0].specifier,
      'npm:@bleedingdev/modern-js-utils@3.2.0-ultramodern.1',
    );
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.outPath, 'utf8')).passed,
      true,
    );
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof rejects npm latest internal resolution', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture({
    stagedDependency: 'latest',
  });

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /must resolve to staged cohort npm:@bleedingdev\/modern-js-utils@3\.2\.0-ultramodern\.1, found latest/,
    );
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof rejects partial single-version cohorts', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture({
    includeCreate: false,
  });

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /Single-version source proof requires every aliased public package/,
    );
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof allows subset cohort against external baseline version', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture({
    dependencyVersion: '3.2.0-ultramodern.0',
    includeCreate: false,
    stagedDependency: 'npm:@bleedingdev/modern-js-utils@3.2.0-ultramodern.0',
  });

  try {
    const proof = validateSourceProof(fixture);

    assert.equal(proof.passed, true);
    assert.equal(proof.checks.singleVersionCohort, 'external-baseline');
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof rejects missing local source package metadata', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture();
  fs.rmSync(path.join(fixture.repoRoot, 'packages/utils'), {
    recursive: true,
    force: true,
  });

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /Missing local source package metadata for @modern-js\/utils/,
    );
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof rejects create framework metadata drift', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture({
    createFrameworkVersion: 'latest',
  });

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /@modern-js\/create staged package must record ultramodern\.frameworkVersion=3\.2\.0-ultramodern\.1/,
    );
  } finally {
    removeDir(fixture.repoRoot);
  }
});
