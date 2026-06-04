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
  'template/.agents/skills-lock.json',
  'template/.browserslistrc',
  'template/.codex/hooks.json',
  'template/.github/renovate.json',
  'template/.github/workflows/ultramodern-gates.yml.handlebars',
  'template/.gitignore.handlebars',
  'template/.mise.toml.handlebars',
  'template/.nvmrc',
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
    tag: 'ultramodern-canary',
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

test('publish-existing rejects create packages missing hidden template files', () => {
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
