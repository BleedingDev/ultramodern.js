import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rstest } from '@rstest/core';

const repoRoot = path.resolve(__dirname, '../../../../');
const createBin = path.resolve(repoRoot, 'packages/toolkit/create/bin/run.js');

function expectNoHandlebarsArtifacts(content: string) {
  expect(/\{\{[#/]|(?:\{\{\w+)/.test(content)).toBe(false);
}

function expectWorkspaceModernVersions(packageJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}) {
  const mergedDependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  Object.entries(mergedDependencies).forEach(([name, version]) => {
    if (name.startsWith('@modern-js/')) {
      expect(version).toBe('workspace:*');
    }
  });
}

function readGeneratedPage(appDir: string) {
  return fs.readFileSync(
    path.join(appDir, 'src/routes/[lang]/page.tsx'),
    'utf-8',
  );
}

function expectPnpm11Policy(projectDir: string) {
  const pnpmWorkspace = fs.readFileSync(
    path.join(projectDir, 'pnpm-workspace.yaml'),
    'utf-8',
  );
  for (const requiredSnippet of [
    'minimumReleaseAge: 1440',
    'minimumReleaseAgeStrict: true',
    'minimumReleaseAgeIgnoreMissingTime: false',
    "minimumReleaseAgeExclude:\n  - '@modern-js/*'\n  - '@bleedingdev/*'\n  - '@effect/tsgo'\n  - '@effect/tsgo-*'\n  - '@typescript/native-preview'\n  - '@typescript/native-preview-*'",
    'trustPolicy: no-downgrade',
    'trustPolicyIgnoreAfter: 1440',
    'blockExoticSubdeps: true',
    'engineStrict: true',
    'pmOnFail: error',
    'verifyDepsBeforeRun: error',
    'strictDepBuilds: true',
    "allowBuilds:\n  '@swc/core': true\n  core-js: true\n  esbuild: true\n  msgpackr-extract: true\n  simple-git-hooks: true",
  ]) {
    expect(pnpmWorkspace).toContain(requiredSnippet);
  }
  expect(pnpmWorkspace).not.toContain('onlyBuiltDependencies');
}

function expectSingleAppContract(appDir: string) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
  );
  expect(packageJson.private).toBe(true);
  expect(packageJson.packageManager).toBe('pnpm@11.1.2');
  expect(packageJson.engines.pnpm).toBe('>=11.0.0');
  expect(packageJson.pnpm).toBeUndefined();
  expect(packageJson.scripts.test).toBe('rstest run');
  expect(packageJson.scripts['ultramodern:check']).toContain('pnpm test');
  expect(
    packageJson.devDependencies['@modern-js/adapter-rstest'],
  ).toBeDefined();
  expect(packageJson.devDependencies['@rstest/core']).toBe('0.10.2');
  expect(packageJson.devDependencies['happy-dom']).toBe('^20.9.0');
  expect(packageJson.modernjs).toEqual({
    preset: 'presetUltramodern',
    packageSource: {
      strategy: packageJson.modernjs.packageSource.strategy,
      config: './.modernjs/ultramodern-package-source.json',
    },
  });
  expect(fs.existsSync(path.join(appDir, 'rstest.config.mts'))).toBe(true);
  expect(
    fs.existsSync(path.join(appDir, 'tests/ultramodern.contract.test.ts')),
  ).toBe(true);
  expect(
    fs.existsSync(
      path.join(appDir, '.modernjs/ultramodern-package-source.json'),
    ),
  ).toBe(true);
  expect(fs.existsSync(path.join(appDir, 'pnpm-workspace.yaml'))).toBe(true);
  expectPnpm11Policy(appDir);
  expect(fs.existsSync(path.join(appDir, 'src/routes/page.tsx'))).toBe(false);
  const page = readGeneratedPage(appDir);
  expect(page).toContain('@modern-js/plugin-tanstack/runtime');
  expect(page).not.toContain('@modern-js/runtime/tanstack-router');
}

function runCreate(projectDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, projectDir, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    stdio: 'pipe',
  });
}

describe('create-tailwind', () => {
  let tempRoot = '';

  beforeAll(() => {
    rstest.setConfig({
      testTimeout: 1000 * 60 * 3,
      hookTimeout: 1000 * 60 * 3,
    });
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-create-tailwind-'),
    );
  });

  afterAll(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scaffolds Tailwind v4 files by default', () => {
    const appDir = path.join(tempRoot, 'with-tailwind');
    runCreate(appDir, ['--router', 'tanstack', '--lang', 'en']);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );
    expect(packageJson.name).toBe('with-tailwind');
    expect(
      packageJson.dependencies['@modern-js/plugin-tanstack'],
    ).toBeDefined();
    expect(packageJson.dependencies['@tanstack/react-router']).toBe('1.170.8');
    expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.0');
    expect(packageJson.devDependencies.postcss).toBe('^8.5.6');
    expect(packageJson.devDependencies['@tailwindcss/postcss']).toBe('^4.3.0');
    expectSingleAppContract(appDir);

    const postcssConfigPath = path.join(appDir, 'postcss.config.mjs');
    expect(fs.existsSync(postcssConfigPath)).toBe(true);
    expect(fs.readFileSync(postcssConfigPath, 'utf-8')).toContain(
      '@tailwindcss/postcss',
    );

    const tailwindConfigPath = path.join(appDir, 'tailwind.config.ts');
    expect(fs.existsSync(tailwindConfigPath)).toBe(true);

    const css = fs.readFileSync(
      path.join(appDir, 'src/routes/index.css'),
      'utf-8',
    );
    expect(css).toContain("@import 'tailwindcss';");

    const pageTsx = readGeneratedPage(appDir);
    expectNoHandlebarsArtifacts(pageTsx);
    expect(pageTsx).toContain('text-emerald-700');
    expect(pageTsx).toContain('font-semibold');

    const modernConfig = fs.readFileSync(
      path.join(appDir, 'modern.config.ts'),
      'utf-8',
    );
    expect(modernConfig).toContain(
      "import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';",
    );
    expect(modernConfig).toContain('tanstackRouterPlugin()');
    expectNoHandlebarsArtifacts(modernConfig);
  });

  test('supports --no-tailwind opt-out', () => {
    const appDir = path.join(tempRoot, 'without-tailwind');
    runCreate(appDir, [
      '--router',
      'tanstack',
      '--no-tailwind',
      '--lang',
      'en',
    ]);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );
    expect(packageJson.devDependencies.tailwindcss).toBeUndefined();
    expect(packageJson.devDependencies.postcss).toBeUndefined();
    expect(packageJson.devDependencies['@tailwindcss/postcss']).toBeUndefined();

    expect(fs.existsSync(path.join(appDir, 'postcss.config.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(appDir, 'tailwind.config.ts'))).toBe(false);

    const css = fs.readFileSync(
      path.join(appDir, 'src/routes/index.css'),
      'utf-8',
    );
    expect(css).not.toContain("@import 'tailwindcss';");

    expectSingleAppContract(appDir);

    const pageTsx = readGeneratedPage(appDir);
    expectNoHandlebarsArtifacts(pageTsx);
    expect(pageTsx).not.toContain('text-emerald-700');
    expect(pageTsx).not.toContain('font-semibold');

    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'modern.config.ts'), 'utf-8'),
    );
  });

  test('keeps Tailwind default-on with --sub', () => {
    const appDir = path.join(tempRoot, 'with-tailwind-sub');
    runCreate(appDir, ['--router', 'tanstack', '--sub', '--lang', 'en']);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );

    expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.0');
    expect(packageJson.devDependencies.postcss).toBe('^8.5.6');
    expect(packageJson.devDependencies['@tailwindcss/postcss']).toBe('^4.3.0');

    expect(packageJson['lint-staged']).toBeUndefined();
    expect(packageJson['simple-git-hooks']).toBeUndefined();
    expect(packageJson.scripts.lint).toBeUndefined();
    expect(packageJson.scripts['lint:fix']).toBeUndefined();
    expect(packageJson.scripts.format).toBeUndefined();
    expect(packageJson.scripts['format:check']).toBeUndefined();
    expect(packageJson.scripts['skills:install']).toBeUndefined();
    expect(packageJson.scripts['skills:check']).toBeUndefined();
    expect(packageJson.scripts.prepare).toBeUndefined();
    expect(packageJson.devDependencies.oxlint).toBeUndefined();
    expect(packageJson.devDependencies.oxfmt).toBeUndefined();
    expect(packageJson.devDependencies.ultracite).toBeUndefined();
    expect(packageJson.devDependencies['lint-staged']).toBeUndefined();
    expect(packageJson.devDependencies['simple-git-hooks']).toBeUndefined();
    expectSingleAppContract(appDir);

    expect(fs.existsSync(path.join(appDir, 'postcss.config.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'tailwind.config.ts'))).toBe(true);
    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'modern.config.ts'), 'utf-8'),
    );
    expectNoHandlebarsArtifacts(readGeneratedPage(appDir));
    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern.mjs'],
      {
        cwd: appDir,
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput).toContain('Ultramodern contract check passed.');
  });

  test('keeps Tailwind default-on with --bff-runtime effect', () => {
    const appDir = path.join(tempRoot, 'with-tailwind-effect');
    runCreate(appDir, [
      '--router',
      'tanstack',
      '--bff-runtime',
      'effect',
      '--lang',
      'en',
    ]);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );
    expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.0');
    expect(packageJson.devDependencies['@modern-js/plugin-bff']).toBeDefined();

    const modernConfig = fs.readFileSync(
      path.join(appDir, 'modern.config.ts'),
      'utf-8',
    );
    expect(modernConfig).toContain("runtimeFramework: 'effect'");
    expect(modernConfig).toContain('openapi: true');
    expectNoHandlebarsArtifacts(modernConfig);

    expect(fs.existsSync(path.join(appDir, 'api/effect/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'shared/effect/api.ts'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'postcss.config.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'tailwind.config.ts'))).toBe(true);
    expectNoHandlebarsArtifacts(readGeneratedPage(appDir));
  });

  test('supports BleedingDev npm aliases for UltraModern package installs', () => {
    const appDir = path.join(tempRoot, 'with-bleedingdev-aliases');
    runCreate(appDir, [
      '--router',
      'tanstack',
      '--bff-runtime',
      'effect',
      '--ultramodern-package-source',
      'install',
      '--ultramodern-package-version',
      '3.2.0-ultramodern.5',
      '--ultramodern-package-scope',
      'bleedingdev',
      '--ultramodern-package-name-prefix',
      'modern-js-',
      '--lang',
      'en',
    ]);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );

    expect(packageJson.dependencies['@modern-js/runtime']).toBe(
      'npm:@bleedingdev/modern-js-runtime@3.2.0-ultramodern.5',
    );
    expect(packageJson.dependencies['@modern-js/plugin-tanstack']).toBe(
      'npm:@bleedingdev/modern-js-plugin-tanstack@3.2.0-ultramodern.5',
    );
    expect(packageJson.devDependencies['@modern-js/app-tools']).toBe(
      'npm:@bleedingdev/modern-js-app-tools@3.2.0-ultramodern.5',
    );
    expect(packageJson.devDependencies['@modern-js/tsconfig']).toBe(
      'npm:@bleedingdev/modern-js-tsconfig@3.2.0-ultramodern.5',
    );
    expect(packageJson.devDependencies['@modern-js/plugin-bff']).toBe(
      'npm:@bleedingdev/modern-js-plugin-bff@3.2.0-ultramodern.5',
    );
    expect(packageJson.devDependencies['@modern-js/adapter-rstest']).toBe(
      'npm:@bleedingdev/modern-js-adapter-rstest@3.2.0-ultramodern.5',
    );

    const packageSource = JSON.parse(
      fs.readFileSync(
        path.join(appDir, '.modernjs/ultramodern-package-source.json'),
        'utf-8',
      ),
    );
    expect(packageSource.modernPackages.aliases).toMatchObject({
      '@modern-js/adapter-rstest': '@bleedingdev/modern-js-adapter-rstest',
      '@modern-js/app-tools': '@bleedingdev/modern-js-app-tools',
      '@modern-js/plugin-bff': '@bleedingdev/modern-js-plugin-bff',
      '@modern-js/plugin-i18n': '@bleedingdev/modern-js-plugin-i18n',
      '@modern-js/plugin-tanstack': '@bleedingdev/modern-js-plugin-tanstack',
      '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
      '@modern-js/tsconfig': '@bleedingdev/modern-js-tsconfig',
    });
  });

  test('keeps Tailwind default-on with --workspace and effect runtime', () => {
    const appDir = path.join(tempRoot, 'with-tailwind-effect-workspace');
    runCreate(appDir, [
      '--router',
      'tanstack',
      '--bff-runtime',
      'effect',
      '--workspace',
      '--lang',
      'en',
    ]);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );
    expectWorkspaceModernVersions(packageJson);
    expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.0');

    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'modern.config.ts'), 'utf-8'),
    );
    expectNoHandlebarsArtifacts(readGeneratedPage(appDir));
  });
});
