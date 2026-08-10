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

function expectGeneratedWorkspaceValid(workspaceDir: string) {
  expect(() =>
    execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      { cwd: workspaceDir, stdio: 'pipe' },
    ),
  ).not.toThrow();
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
      'workspace:*',
    );
    expect(verticalPackage.dependencies['@modern-js/plugin-bff']).toBe(
      'workspace:*',
    );
    expect(verticalPackage.dependencies['@tanstack/react-router']).toBe(
      '1.170.25',
    );
    expect(verticalPackage.devDependencies.tailwindcss).toBe('^4.3.3');
    expect(verticalPackage.devDependencies['@rsbuild/plugin-tailwindcss']).toBe(
      '^2.0.3',
    );

    expectNoPath(workspaceDir, 'verticals/greetings/api/lambda');
    expectPath(workspaceDir, 'verticals/greetings/api/index.ts');
    expectPath(workspaceDir, 'verticals/greetings/shared/api.ts');
    expectNoPath(workspaceDir, 'verticals/greetings/postcss.config.mjs');
    expectPath(workspaceDir, 'verticals/greetings/tailwind.config.ts');
    expectGeneratedWorkspaceValid(workspaceDir);
  });

  test('scaffolds the strict Effect approach with an explicit --bff-runtime effect', () => {
    const workspaceDir = path.join(tempRoot, 'with-bff-effect');
    scaffoldWorkspaceWithVertical(
      workspaceDir,
      ['--bff-runtime', 'effect', '--lang', 'en'],
      ['greetings', '--vertical', '--bff-runtime', 'effect', '--lang', 'en'],
    );

    expectNoPath(workspaceDir, 'verticals/greetings/api/lambda');
    expectPath(workspaceDir, 'verticals/greetings/api/index.ts');
    expectPath(workspaceDir, 'verticals/greetings/shared/api.ts');
    expectPath(workspaceDir, 'verticals/greetings/src/api/greetings-client.ts');

    const tsConfig = readJson<{ include: string[] }>(
      workspaceDir,
      'verticals/greetings/tsconfig.json',
    );
    expect(tsConfig.include).toContain('api');
    expect(tsConfig.include).toContain('shared');
    expectGeneratedWorkspaceValid(workspaceDir);
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

    expectGeneratedWorkspaceValid(workspaceDir);
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
