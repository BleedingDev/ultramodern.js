import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../');
const createBin = path.resolve(repoRoot, 'packages/toolkit/create/bin/run.js');
const testFrameworkVersion = '3.2.0-ultramodern.108';
const frameworkVersionEnv = 'MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION';

type ExecSyncError = Error & {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
};

function expectedBleedingDevSpecifier(packageName: string) {
  const unscopedName = packageName.split('/').at(-1);
  return `npm:@bleedingdev/modern-js-${unscopedName}@${testFrameworkVersion}`;
}

// Generated apps legitimately ship i18next interpolation placeholders
// ({{lng}}/{{ns}} in the locale backend loadPath); everything else shaped
// like a handlebars expression is a leaked template artifact.
function expectNoTemplateArtifacts(content: string) {
  const withoutI18nextPlaceholders = content.replaceAll(
    /\{\{(?:lng|ns)\}\}/gu,
    '',
  );
  expect(withoutI18nextPlaceholders).not.toMatch(/\{\{[#/\w]/u);
}

function expectWorkspaceModernVersions(packageJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}) {
  const mergedDependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  const modernDependencies = Object.entries(mergedDependencies).filter(
    ([name]) => name.startsWith('@modern-js/'),
  );
  expect(modernDependencies.length).toBeGreaterThan(0);
  for (const [, version] of modernDependencies) {
    expect(version).toBe('workspace:*');
  }
}

function runCreate(projectDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, projectDir, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      [frameworkVersionEnv]: testFrameworkVersion,
    },
    stdio: 'pipe',
  });
}

function runCreateInWorkspace(workspaceDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, ...args], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      [frameworkVersionEnv]: testFrameworkVersion,
    },
    stdio: 'pipe',
  });
}

function readText(root: string, relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

function readJson<T = any>(root: string, relativePath: string): T {
  return JSON.parse(readText(root, relativePath));
}

function expectPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(true);
}

function expectNoPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
}

function scaffoldWorkspaceWithVertical(
  workspaceDir: string,
  workspaceArgs: string[],
  verticalArgs: string[],
) {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  runCreate(workspaceDir, workspaceArgs);
  runCreateInWorkspace(workspaceDir, verticalArgs);
}

function captureCreateFailure(projectDir: string, args: string[]): string {
  try {
    runCreate(projectDir, args);
  } catch (error) {
    const execError = error as ExecSyncError;
    return typeof execError.stderr === 'string'
      ? execError.stderr
      : execError.stderr?.toString() || '';
  }
  throw new Error(
    `Expected create to fail for: ${args.join(' ')} (it succeeded)`,
  );
}

describe('create-bff-runtime', () => {
  let tempRoot = '';

  beforeAll(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-create-bff-runtime-'),
    );
  });

  afterAll(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scaffolds the strict Effect approach by default with --bff', () => {
    const workspaceDir = path.join(tempRoot, 'with-bff-effect-default');
    scaffoldWorkspaceWithVertical(
      workspaceDir,
      ['--bff', '--lang', 'en'],
      ['greetings', '--vertical', '--lang', 'en'],
    );

    const rootPackage = readJson(workspaceDir, 'package.json');
    expect(rootPackage.name).toBe('with-bff-effect-default');

    const verticalPackage = readJson(
      workspaceDir,
      'verticals/greetings/package.json',
    );
    expect(verticalPackage.dependencies['@modern-js/plugin-tanstack']).toBe(
      expectedBleedingDevSpecifier('@modern-js/plugin-tanstack'),
    );
    expect(verticalPackage.dependencies['@modern-js/plugin-bff']).toBe(
      expectedBleedingDevSpecifier('@modern-js/plugin-bff'),
    );
    expect(verticalPackage.dependencies['@tanstack/react-router']).toBe(
      '1.170.17',
    );
    expect(verticalPackage.devDependencies.tailwindcss).toBe('^4.3.2');
    expect(verticalPackage.devDependencies['@rsbuild/plugin-tailwindcss']).toBe(
      '^2.0.3',
    );

    const modernConfig = readText(
      workspaceDir,
      'verticals/greetings/modern.config.ts',
    );
    expect(modernConfig).toContain(
      "import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';",
    );
    expect(modernConfig).toContain('tanstackRouterPlugin(');
    expect(modernConfig).toContain('bffPlugin(),');
    expect(modernConfig).toContain("runtimeFramework: 'effect'");
    expect(modernConfig).toContain("path: '/openapi.json'");
    expect(modernConfig).toContain("prefix: '/greetings-api'");
    expectNoTemplateArtifacts(modernConfig);

    expectNoPath(workspaceDir, 'verticals/greetings/api/lambda');
    expectPath(workspaceDir, 'verticals/greetings/api/index.ts');
    expectPath(workspaceDir, 'verticals/greetings/shared/api.ts');
    expectNoPath(workspaceDir, 'verticals/greetings/postcss.config.mjs');
    expectPath(workspaceDir, 'verticals/greetings/tailwind.config.ts');
    expect(
      readText(workspaceDir, 'verticals/greetings/src/routes/index.css'),
    ).toContain("@import 'tailwindcss'");

    expectNoTemplateArtifacts(
      readText(workspaceDir, 'verticals/greetings/src/routes/[lang]/page.tsx'),
    );
  });

  test('scaffolds the strict Effect approach with an explicit --bff-runtime effect', () => {
    const workspaceDir = path.join(tempRoot, 'with-bff-effect');
    scaffoldWorkspaceWithVertical(
      workspaceDir,
      ['--bff-runtime', 'effect', '--lang', 'en'],
      ['greetings', '--vertical', '--bff-runtime', 'effect', '--lang', 'en'],
    );

    const effectEntry = readText(
      workspaceDir,
      'verticals/greetings/api/index.ts',
    );
    expect(effectEntry).toContain('defineEffectBff');
    expect(effectEntry).toContain("from '@modern-js/plugin-bff/effect-edge'");
    expect(effectEntry).toContain("from '../shared/api.ts'");
    expectNoPath(workspaceDir, 'verticals/greetings/api/lambda');

    const sharedEffectApi = readText(
      workspaceDir,
      'verticals/greetings/shared/api.ts',
    );
    expect(sharedEffectApi).toContain('@modern-js/plugin-bff/effect-client');
    expect(sharedEffectApi).toContain('greetingsApi');

    expectPath(workspaceDir, 'verticals/greetings/src/api/greetings-client.ts');
    const routePage = readText(
      workspaceDir,
      'verticals/greetings/src/routes/[lang]/page.tsx',
    );
    expectNoTemplateArtifacts(routePage);
    expect(routePage).toContain("from '../../api/greetings-client'");
    expect(routePage).toContain('data-testid="api-status"');

    const tsConfig = readJson<{ include: string[] }>(
      workspaceDir,
      'verticals/greetings/tsconfig.json',
    );
    expect(tsConfig.include).toContain('api');
    expect(tsConfig.include).toContain('shared');
  });

  test('rejects the removed hono BFF runtime with an actionable error', () => {
    const appDir = path.join(tempRoot, 'with-bff-hono');

    const stderr = captureCreateFailure(appDir, [
      '--bff-runtime',
      'hono',
      '--lang',
      'en',
    ]);
    expect(stderr).toContain('Unsupported BFF runtime "hono"');
    expect(stderr).toContain('supported: effect');
    expect(fs.existsSync(appDir)).toBe(false);
  });

  test('scaffolds workspace protocol versions with --workspace', () => {
    const workspaceDir = path.join(tempRoot, 'with-bff-workspace');
    scaffoldWorkspaceWithVertical(
      workspaceDir,
      ['--bff-runtime', 'effect', '--workspace', '--lang', 'en'],
      ['greetings', '--vertical', '--lang', 'en'],
    );

    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    expect(ultramodernConfig.packageSource.strategy).toBe('workspace');
    expect(ultramodernConfig.packageSource.modernPackageVersion).toBe(
      'workspace:*',
    );

    expectWorkspaceModernVersions(readJson(workspaceDir, 'package.json'));
    expectWorkspaceModernVersions(
      readJson(workspaceDir, 'apps/shell-super-app/package.json'),
    );
    expectWorkspaceModernVersions(
      readJson(workspaceDir, 'verticals/greetings/package.json'),
    );

    const modernConfig = readText(
      workspaceDir,
      'verticals/greetings/modern.config.ts',
    );
    expect(modernConfig).toContain("runtimeFramework: 'effect'");
    expectNoTemplateArtifacts(modernConfig);
  });

  test('fails on an unsupported BFF runtime', () => {
    const appDir = path.join(tempRoot, 'with-bff-invalid');

    const stderr = captureCreateFailure(appDir, [
      '--bff-runtime',
      'unknown-runtime',
      '--lang',
      'en',
    ]);
    expect(stderr).toContain('Unsupported BFF runtime "unknown-runtime"');
    expect(stderr).toContain('supported: effect');
    expect(fs.existsSync(appDir)).toBe(false);
  });
});
