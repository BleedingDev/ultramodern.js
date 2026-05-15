import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    jest.setTimeout(1000 * 60 * 3);
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-create-tailwind-'),
    );
  });

  afterAll(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scaffolds Tailwind v4 files with --tailwind', () => {
    const appDir = path.join(tempRoot, 'with-tailwind');
    runCreate(appDir, ['--router', 'tanstack', '--tailwind', '--lang', 'en']);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );
    expect(packageJson.name).toBe('with-tailwind');
    expect(
      packageJson.dependencies['@modern-js/plugin-tanstack'],
    ).toBeDefined();
    expect(packageJson.dependencies['@tanstack/react-router']).toBe('1.169.2');
    expect(packageJson.devDependencies.tailwindcss).toBe('^4.1.18');
    expect(packageJson.devDependencies.postcss).toBe('^8.5.6');
    expect(packageJson.devDependencies['@tailwindcss/postcss']).toBe('^4.1.18');

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

    const pageTsx = fs.readFileSync(
      path.join(appDir, 'src/routes/page.tsx'),
      'utf-8',
    );
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

  test('keeps default css scaffold when --tailwind is not set', () => {
    const appDir = path.join(tempRoot, 'without-tailwind');
    runCreate(appDir, ['--router', 'tanstack', '--lang', 'en']);

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

    const pageTsx = fs.readFileSync(
      path.join(appDir, 'src/routes/page.tsx'),
      'utf-8',
    );
    expectNoHandlebarsArtifacts(pageTsx);
    expect(pageTsx).not.toContain('text-emerald-700');
    expect(pageTsx).not.toContain('font-semibold');

    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'modern.config.ts'), 'utf-8'),
    );
  });

  test('supports --tailwind with --sub', () => {
    const appDir = path.join(tempRoot, 'with-tailwind-sub');
    runCreate(appDir, [
      '--router',
      'tanstack',
      '--tailwind',
      '--sub',
      '--lang',
      'en',
    ]);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );

    expect(packageJson.devDependencies.tailwindcss).toBe('^4.1.18');
    expect(packageJson.devDependencies.postcss).toBe('^8.5.6');
    expect(packageJson.devDependencies['@tailwindcss/postcss']).toBe('^4.1.18');

    expect(packageJson['lint-staged']).toBeUndefined();
    expect(packageJson['simple-git-hooks']).toBeUndefined();
    expect(packageJson.scripts.lint).toBeUndefined();
    expect(packageJson.scripts.prepare).toBeUndefined();
    expect(packageJson.devDependencies['@biomejs/biome']).toBeUndefined();
    expect(packageJson.devDependencies['lint-staged']).toBeUndefined();
    expect(packageJson.devDependencies['simple-git-hooks']).toBeUndefined();

    expect(fs.existsSync(path.join(appDir, 'postcss.config.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'tailwind.config.ts'))).toBe(true);
    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'modern.config.ts'), 'utf-8'),
    );
    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'src/routes/page.tsx'), 'utf-8'),
    );
  });

  test('supports --tailwind with --bff-runtime effect', () => {
    const appDir = path.join(tempRoot, 'with-tailwind-effect');
    runCreate(appDir, [
      '--router',
      'tanstack',
      '--tailwind',
      '--bff-runtime',
      'effect',
      '--lang',
      'en',
    ]);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );
    expect(packageJson.devDependencies.tailwindcss).toBe('^4.1.18');
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
    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'src/routes/page.tsx'), 'utf-8'),
    );
  });

  test('supports --workspace with tailwind and effect runtime', () => {
    const appDir = path.join(tempRoot, 'with-tailwind-effect-workspace');
    runCreate(appDir, [
      '--router',
      'tanstack',
      '--tailwind',
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
    expect(packageJson.devDependencies.tailwindcss).toBe('^4.1.18');

    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'modern.config.ts'), 'utf-8'),
    );
    expectNoHandlebarsArtifacts(
      fs.readFileSync(path.join(appDir, 'src/routes/page.tsx'), 'utf-8'),
    );
  });
});
