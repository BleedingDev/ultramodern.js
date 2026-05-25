import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rstest } from '@rstest/core';

const repoRoot = path.resolve(__dirname, '../../../../');
const createBin = path.resolve(repoRoot, 'packages/toolkit/create/bin/run.js');

type ExecSyncError = Error & {
  stderr?: Buffer | string;
};

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

describe('create-bff-runtime', () => {
  let tempRoot = '';

  beforeAll(() => {
    rstest.setConfig({
      testTimeout: 1000 * 60 * 3,
      hookTimeout: 1000 * 60 * 3,
    });
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-create-bff-runtime-'),
    );
  });

  afterAll(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scaffolds effect runtime by default with --bff', () => {
    const appDir = path.join(tempRoot, 'with-bff-effect-default');
    fs.rmSync(appDir, { recursive: true, force: true });
    runCreate(appDir, ['--bff', '--lang', 'en']);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );
    expect(packageJson.name).toBe('with-bff-effect-default');
    expect(packageJson.devDependencies['@modern-js/plugin-bff']).toBeDefined();
    expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.0');
    expect(packageJson.devDependencies['@tailwindcss/postcss']).toBe('^4.3.0');

    const modernConfig = fs.readFileSync(
      path.join(appDir, 'modern.config.ts'),
      'utf-8',
    );
    expect(modernConfig).toContain('bffPlugin()');
    expect(modernConfig).toContain("runtimeFramework: 'effect'");
    expect(modernConfig).toContain('openapi: true');
    expectNoHandlebarsArtifacts(modernConfig);

    expect(fs.existsSync(path.join(appDir, 'api/lambda/hello.ts'))).toBe(false);
    expect(fs.existsSync(path.join(appDir, 'api/effect/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'shared/effect/api.ts'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'postcss.config.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'tailwind.config.ts'))).toBe(true);
    expect(
      fs.readFileSync(path.join(appDir, 'src/routes/index.css'), 'utf-8'),
    ).toContain("@import 'tailwindcss';");

    const routePage = path.join(appDir, 'src/routes/[lang]/page.tsx');
    expectNoHandlebarsArtifacts(fs.readFileSync(routePage, 'utf-8'));
  });

  test('scaffolds effect runtime with --bff-runtime effect', () => {
    const appDir = path.join(tempRoot, 'with-bff-effect');
    fs.rmSync(appDir, { recursive: true, force: true });
    runCreate(appDir, ['--router', 'tanstack', '--bff-runtime', 'effect']);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
    );
    expect(
      packageJson.dependencies['@modern-js/plugin-tanstack'],
    ).toBeDefined();
    expect(packageJson.dependencies['@tanstack/react-router']).toBe('1.170.8');
    expect(packageJson.devDependencies['@modern-js/plugin-bff']).toBeDefined();
    expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.0');

    const modernConfig = fs.readFileSync(
      path.join(appDir, 'modern.config.ts'),
      'utf-8',
    );
    expect(modernConfig).toContain(
      "import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';",
    );
    expect(modernConfig).toContain('tanstackRouterPlugin()');
    expect(modernConfig).toContain('bffPlugin()');
    expect(modernConfig).toContain("runtimeFramework: 'effect'");
    expect(modernConfig).toContain('openapi: true');
    expectNoHandlebarsArtifacts(modernConfig);

    const effectEntry = path.join(appDir, 'api/effect/index.ts');
    expect(fs.existsSync(effectEntry)).toBe(true);
    expect(fs.readFileSync(effectEntry, 'utf-8')).toContain('defineEffectBff');
    expect(fs.readFileSync(effectEntry, 'utf-8')).toContain('bffEffectApi');
    expect(fs.existsSync(path.join(appDir, 'api/lambda/hello.ts'))).toBe(false);

    const sharedEffectApi = path.join(appDir, 'shared/effect/api.ts');
    expect(fs.existsSync(sharedEffectApi)).toBe(true);
    expect(fs.readFileSync(sharedEffectApi, 'utf-8')).toContain(
      '@modern-js/plugin-bff/effect-client',
    );

    const routePage = path.join(appDir, 'src/routes/[lang]/page.tsx');
    expectNoHandlebarsArtifacts(fs.readFileSync(routePage, 'utf-8'));
    expect(fs.readFileSync(routePage, 'utf-8')).toContain(
      "import effectBff from '@api/effect/index'",
    );
    expect(fs.readFileSync(routePage, 'utf-8')).toContain(
      'effectBff.client.greetings.hello',
    );

    const tsConfig = fs.readFileSync(
      path.join(appDir, 'tsconfig.json'),
      'utf-8',
    );
    expect(tsConfig).toContain('"@api/*"');
    expect(tsConfig).toContain('"api"');
  });

  test('scaffolds hono runtime with --bff-runtime hono', () => {
    const appDir = path.join(tempRoot, 'with-bff-hono');
    fs.rmSync(appDir, { recursive: true, force: true });
    runCreate(appDir, ['--router', 'tanstack', '--bff-runtime', 'hono']);

    const modernConfig = fs.readFileSync(
      path.join(appDir, 'modern.config.ts'),
      'utf-8',
    );
    expect(modernConfig).toContain("runtimeFramework: 'hono'");
    expect(modernConfig).not.toContain('openapi: true');
    expectNoHandlebarsArtifacts(modernConfig);

    expect(fs.existsSync(path.join(appDir, 'api/lambda/hello.ts'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'api/effect/index.ts'))).toBe(false);
    expect(fs.existsSync(path.join(appDir, 'shared/effect/api.ts'))).toBe(
      false,
    );

    const routePage = path.join(appDir, 'src/routes/[lang]/page.tsx');
    const routePageContent = fs.readFileSync(routePage, 'utf-8');
    expectNoHandlebarsArtifacts(routePageContent);
    expect(routePageContent).not.toContain(
      "import effectBff from '@api/effect/index'",
    );
  });

  test('scaffolds workspace versions with --workspace', () => {
    const appDir = path.join(tempRoot, 'with-bff-workspace');
    fs.rmSync(appDir, { recursive: true, force: true });
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

    const modernConfig = fs.readFileSync(
      path.join(appDir, 'modern.config.ts'),
      'utf-8',
    );
    expectNoHandlebarsArtifacts(modernConfig);
  });

  test('fails on unsupported bff runtime', () => {
    const appDir = path.join(tempRoot, 'with-bff-invalid');

    try {
      runCreate(appDir, ['--bff-runtime', 'unknown-runtime', '--lang', 'en']);
      throw new Error('Expected create command to fail for invalid runtime');
    } catch (error) {
      const execError = error as ExecSyncError;
      const stderr =
        typeof execError.stderr === 'string'
          ? execError.stderr
          : execError.stderr?.toString() || '';
      expect(stderr).toContain('Unsupported BFF runtime');
    }
  });
});
