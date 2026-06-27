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

const writeFile = (filePath, content = 'fixture\n') => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

const createPublicExport = {
  types: './dist/types/ultramodern-workspace/public-api.d.ts',
  node: {
    import: './dist/esm-node/ultramodern-workspace/public-api.js',
    require: './dist/cjs/ultramodern-workspace/public-api.cjs',
  },
  default: './dist/esm-node/ultramodern-workspace/public-api.js',
};
const createCodeSmithExport = {
  types: './dist/types/ultramodern-workspace/codesmith.d.ts',
  node: {
    import: './dist/esm-node/ultramodern-workspace/codesmith.js',
    require: './dist/cjs/ultramodern-workspace/codesmith.cjs',
  },
  default: './dist/esm-node/ultramodern-workspace/codesmith.js',
};
const createRootExport = {
  types: './dist/types/index.d.ts',
  node: {
    import: './dist/esm-node/index.js',
    require: './dist/cjs/index.cjs',
  },
  default: './dist/esm-node/index.js',
};
const createPackageExports = {
  '.': createRootExport,
  './ultramodern-workspace': createPublicExport,
  './ultramodern-workspace/codesmith': createCodeSmithExport,
};
const createPublishedPaths = [
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
  'template-workspace/.agents/agent-reference-repos.json',
  'template-workspace/.codex/rstackjs-agent-skills-LICENSE',
  'template-workspace/.codex/skills-lock.json',
  'template-workspace/.codex/hooks.json',
  'template-workspace/.github/renovate.json',
  'template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
  'template-workspace/.gitignore.handlebars',
  'template-workspace/.mise.toml.handlebars',
  'templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars',
];

const writeCreatePublishSurface = packageDir => {
  for (const relativePath of createPublishedPaths) {
    writeFile(path.join(packageDir, relativePath));
  }
};

const makePackageJson = ({
  dir,
  name,
  version = '1.0.0',
  dependencies,
  devDependencies,
  ultramodern,
  extra = {},
}) => {
  writeJson(path.join(dir, 'package.json'), {
    name,
    version,
    repository: {
      type: 'git',
      url: 'git+https://github.com/BleedingDev/ultramodern.js.git',
    },
    ...extra,
    publishConfig: {
      access: 'public',
      ...(extra.publishConfig ?? {}),
    },
    ...(dependencies ? { dependencies } : {}),
    ...(devDependencies ? { devDependencies } : {}),
    ...(ultramodern ? { ultramodern } : {}),
  });
};

const makeFixture = ({
  dependencyVersion = '3.2.0-ultramodern.1',
  includeUtils = true,
  includeCreate = true,
  stagedDependency = 'npm:@bleedingdev/modern-js-utils@3.2.0-ultramodern.1',
  stagedCreateI18nDependency = 'npm:@bleedingdev/modern-js-i18n-utils@3.2.0-ultramodern.1',
  stagedCreateCodeSmithDependency = '2.6.9',
  createI18nDependencyBlock = 'dependencies',
  externalDependency,
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
    '@modern-js/i18n-utils': '@bleedingdev/modern-js-i18n-utils',
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
      ...(externalDependency
        ? { '@modern-js/polyfill-lib': externalDependency }
        : {}),
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

  makePackageJson({
    dir: path.join(repoRoot, 'packages/toolkit/i18n-utils'),
    name: '@modern-js/i18n-utils',
  });
  makePackageJson({
    dir: path.join(repoRoot, '.modern/bleedingdev-publish/packages/i18n-utils'),
    name: '@bleedingdev/modern-js-i18n-utils',
    version: '3.2.0-ultramodern.1',
  });
  packages.push({
    sourceName: '@modern-js/i18n-utils',
    targetName: '@bleedingdev/modern-js-i18n-utils',
    version: '3.2.0-ultramodern.1',
    packageDir: '.modern/bleedingdev-publish/packages/i18n-utils',
  });

  if (includeCreate) {
    const createI18nDependency =
      createI18nDependencyBlock === 'missing'
        ? undefined
        : { '@modern-js/i18n-utils': stagedCreateI18nDependency };
    makePackageJson({
      dir: path.join(repoRoot, 'packages/toolkit/create'),
      name: '@modern-js/create',
      extra: {
        exports: createPackageExports,
        publishConfig: {
          exports: createPackageExports,
        },
      },
    });
    const createPackageDir = path.join(
      repoRoot,
      '.modern/bleedingdev-publish/packages/create',
    );
    makePackageJson({
      dir: createPackageDir,
      name: '@bleedingdev/modern-js-create',
      version: '3.2.0-ultramodern.1',
      dependencies: {
        '@modern-js/codesmith': stagedCreateCodeSmithDependency,
        oxfmt: '0.55.0',
        ultracite: '7.8.3',
        ...(createI18nDependencyBlock === 'dependencies'
          ? createI18nDependency
          : {}),
      },
      devDependencies:
        createI18nDependencyBlock === 'devDependencies'
          ? createI18nDependency
          : undefined,
      ultramodern: {
        frameworkVersion: createFrameworkVersion,
      },
      extra: {
        main: './dist/esm-node/index.js',
        types: './dist/types/index.d.ts',
        bin: {
          'modern-js-create': './bin/run.js',
        },
        files: ['template-workspace', 'templates', 'dist', 'bin'],
        typesVersions: {
          '*': {
            'ultramodern-workspace': [
              './dist/types/ultramodern-workspace/public-api.d.ts',
            ],
            'ultramodern-workspace/codesmith': [
              './dist/types/ultramodern-workspace/codesmith.d.ts',
            ],
          },
        },
        exports: createPackageExports,
        publishConfig: {
          exports: createPackageExports,
        },
      },
    });
    writeCreatePublishSurface(createPackageDir);
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
    tag: 'latest',
    aliases,
    packages,
  });

  return {
    repoRoot,
    manifestPath,
    outPath,
    runRuntimeCreateProof: false,
  };
};

test('parseArgs preserves source-proof CLI conventions while using shared parser', async () => {
  const { parseArgs } = await import('../validate-source-create-proof.mjs');
  const options = parseArgs([
    '--',
    '--root',
    '.',
    '--manifest',
    '.modern/bleedingdev-publish/manifest.json',
    '--out',
    '.modern/prepublish-release-gates/source-create-proof.json',
  ]);

  assert.equal(options.repoRoot, path.resolve('.'));
  assert.equal(
    options.manifestPath,
    path.resolve('.modern/bleedingdev-publish/manifest.json'),
  );
  assert.equal(
    options.outPath,
    path.resolve('.modern/prepublish-release-gates/source-create-proof.json'),
  );
  assert.equal(
    parseArgs(['--root', '--out=x']).repoRoot,
    path.resolve('--out=x'),
  );
  assert.throws(
    () => parseArgs(['--root=.']),
    /^Error: Unknown argument: --root=\.$/,
  );
});

test('validateSourceProof accepts staged local cohort metadata', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture();

  try {
    const proof = validateSourceProof(fixture);

    assert.equal(proof.passed, true);
    assert.equal(proof.cohort.packageCount, 4);
    assert.equal(
      proof.createPackageProof.frameworkVersion,
      '3.2.0-ultramodern.1',
    );
    assert.equal(
      proof.packages.find(item => item.sourceName === '@modern-js/runtime')
        .internalDependencyChecks[0].specifier,
      'npm:@bleedingdev/modern-js-utils@3.2.0-ultramodern.1',
    );
    assert.deepEqual(proof.createPackageProof.runtimeDependencyChecks, [
      {
        dependencyName: '@modern-js/codesmith',
        specifier: '2.6.9',
      },
      {
        dependencyName: '@modern-js/i18n-utils',
        specifier: 'npm:@bleedingdev/modern-js-i18n-utils@3.2.0-ultramodern.1',
      },
      {
        dependencyName: 'oxfmt',
        specifier: '0.55.0',
      },
      {
        dependencyName: 'ultracite',
        specifier: '7.8.3',
      },
    ]);
    assert.deepEqual(proof.createPackageProof.runtimeProof, {
      skipped: true,
    });
    assert.equal(
      JSON.parse(fs.readFileSync(fixture.outPath, 'utf8')).passed,
      true,
    );
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof rejects create i18n-utils as a dev-only dependency', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture({
    createI18nDependencyBlock: 'devDependencies',
  });

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /@bleedingdev\/modern-js-create dependencies\.@modern-js\/i18n-utils is required because create imports it at runtime/,
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

test('validateSourceProof allows non-workspace external Modern registry dependencies', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture({
    externalDependency: '^1.0.2',
  });

  try {
    const proof = validateSourceProof(fixture);
    const externalCheck = proof.packages
      .find(item => item.sourceName === '@modern-js/runtime')
      .internalDependencyChecks.find(
        item => item.dependencyName === '@modern-js/polyfill-lib',
      );

    assert.deepEqual(externalCheck, {
      blockName: 'dependencies',
      dependencyName: '@modern-js/polyfill-lib',
      specifier: '^1.0.2',
      resolution: 'external-registry',
    });
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof rejects non-aliased Modern workspace dependencies', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture({
    externalDependency: 'workspace:*',
  });

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /@bleedingdev\/modern-js-runtime dependencies\.@modern-js\/polyfill-lib still uses workspace:\*/,
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

test('validateSourceProof rejects subset cohort against external baseline version', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture({
    dependencyVersion: '3.2.0-ultramodern.0',
    includeCreate: false,
    stagedDependency: 'npm:@bleedingdev/modern-js-utils@3.2.0-ultramodern.0',
  });

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /Publish manifest dependencyVersion must equal version for full BleedingDev cohorts/,
    );
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

test('validateSourceProof records installed create package runtime proof', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture();

  try {
    const proof = validateSourceProof({
      ...fixture,
      runRuntimeCreateProof: true,
      createPackageRuntimeProofRunner: ({
        createItem,
        createPackageDir,
        manifest,
        repoRoot,
        sourcePackageDir,
        sourcePackageDirs,
      }) => {
        assert.equal(createItem.sourceName, '@modern-js/create');
        assert.equal(createItem.targetName, '@bleedingdev/modern-js-create');
        assert.equal(
          createPackageDir,
          path.join(
            fixture.repoRoot,
            '.modern/bleedingdev-publish/packages/create',
          ),
        );
        assert.equal(manifest.dependencyVersion, '3.2.0-ultramodern.1');
        assert.equal(repoRoot, fixture.repoRoot);
        assert.equal(
          sourcePackageDir,
          path.join(fixture.repoRoot, 'packages/toolkit/create'),
        );
        assert.equal(
          sourcePackageDirs['@modern-js/i18n-utils'],
          path.join(fixture.repoRoot, 'packages/toolkit/i18n-utils'),
        );
        assert.equal(
          sourcePackageDirs['@modern-js/utils'],
          path.join(fixture.repoRoot, 'packages/utils'),
        );
        return {
          packedTarball: 'bleedingdev-modern-js-create.tgz',
          installedPackageName: '@bleedingdev/modern-js-create',
          cliWorkspace: 'cli-proof-workspace',
          esmWorkspace: 'esm-proof-workspace',
          cjsWorkspace: 'cjs-proof-workspace',
          importedSubpaths: [
            '@bleedingdev/modern-js-create/ultramodern-workspace',
            '@bleedingdev/modern-js-create/ultramodern-workspace/codesmith',
          ],
        };
      },
    });

    assert.equal(
      proof.createPackageProof.runtimeProof.installedPackageName,
      '@bleedingdev/modern-js-create',
    );
    assert.deepEqual(proof.createPackageProof.publicExportChecks, {
      publicSubpaths: [
        '.',
        './ultramodern-workspace',
        './ultramodern-workspace/codesmith',
      ],
    });
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof categorizes stale create export metadata', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture();
  const createPackageJsonPath = path.join(
    fixture.repoRoot,
    'packages/toolkit/create/package.json',
  );
  const createPackageJson = JSON.parse(
    fs.readFileSync(createPackageJsonPath, 'utf8'),
  );
  delete createPackageJson.publishConfig.exports[
    './ultramodern-workspace/codesmith'
  ];
  writeJson(createPackageJsonPath, createPackageJson);

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /export config: @bleedingdev\/modern-js-create package exports and source publishConfig\.exports must expose the same subpaths/,
    );
  } finally {
    removeDir(fixture.repoRoot);
  }
});

test('validateSourceProof categorizes missing create package files', async () => {
  const { validateSourceProof } = await import(
    '../validate-source-create-proof.mjs'
  );
  const fixture = makeFixture();
  fs.rmSync(
    path.join(
      fixture.repoRoot,
      '.modern/bleedingdev-publish/packages/create/template-workspace/.codex/skills-lock.json',
    ),
  );

  try {
    assert.throws(
      () => validateSourceProof(fixture),
      /template\/package files: @bleedingdev\/modern-js-create staged package is missing required published path: template-workspace\/\.codex\/skills-lock\.json/,
    );
  } finally {
    removeDir(fixture.repoRoot);
  }
});
