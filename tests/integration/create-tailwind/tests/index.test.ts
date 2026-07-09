import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rstest } from '@rstest/core';

const repoRoot = path.resolve(__dirname, '../../../../');
const createBin = path.resolve(repoRoot, 'packages/toolkit/create/bin/run.js');
const expectedBleedingDevFrameworkVersion = '3.2.0-ultramodern.108';
const expectedEffectVersion = '4.0.0-beta.94';
const expectedTypeScriptVersion = '7.0.2';
const shellAppPath = 'apps/shell-super-app';

function readJson<T = any>(baseDir: string, relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relativePath), 'utf-8'));
}

function expectPnpm11OrNewerPackageManager(packageManager: unknown): string {
  expect(typeof packageManager).toBe('string');
  const match = /^pnpm@(\d+)\.(\d+)\.(\d+)$/u.exec(String(packageManager));
  expect(match).not.toBeNull();
  expect(Number(match?.[1])).toBeGreaterThanOrEqual(11);
  return `${match?.[1]}.${match?.[2]}.${match?.[3]}`;
}

function readPnpmConfig<T = any>(
  projectDir: string,
  key: string,
): T | undefined {
  const env = { ...process.env };
  for (const envKey of Object.keys(env)) {
    if (/^(?:npm|pnpm)_config_/i.test(envKey)) {
      delete env[envKey];
    }
  }
  const output = execFileSync('pnpm', ['config', 'get', key, '--json'], {
    cwd: projectDir,
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : undefined;
}

function expectPnpm11Policy(projectDir: string) {
  expect(readPnpmConfig(projectDir, 'minimumReleaseAge')).toBe(1440);
  expect(readPnpmConfig(projectDir, 'minimumReleaseAgeStrict')).toBe(true);
  expect(readPnpmConfig(projectDir, 'minimumReleaseAgeIgnoreMissingTime')).toBe(
    false,
  );
  expect(readPnpmConfig(projectDir, 'minimumReleaseAgeExclude')).toEqual([
    '@bleedingdev/modern-js-*',
    `effect@${expectedEffectVersion}`,
    `@effect/opentelemetry@${expectedEffectVersion}`,
    '@tanstack/react-router',
    '@tanstack/router-core',
    'typescript',
    `typescript@${expectedTypeScriptVersion}`,
    '@typescript/typescript6@6.0.2',
    `@typescript/typescript-aix-ppc64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-darwin-arm64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-darwin-x64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-freebsd-arm64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-freebsd-x64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-linux-arm64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-linux-arm@${expectedTypeScriptVersion}`,
    `@typescript/typescript-linux-loong64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-linux-mips64el@${expectedTypeScriptVersion}`,
    `@typescript/typescript-linux-ppc64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-linux-riscv64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-linux-s390x@${expectedTypeScriptVersion}`,
    `@typescript/typescript-linux-x64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-netbsd-arm64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-netbsd-x64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-openbsd-arm64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-openbsd-x64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-sunos-x64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-win32-arm64@${expectedTypeScriptVersion}`,
    `@typescript/typescript-win32-x64@${expectedTypeScriptVersion}`,
    '@rsbuild/plugin-tailwindcss',
    '@types/react',
    '@rsbuild/core',
    '@rsbuild/plugin-react',
    '@rsbuild/plugin-type-check',
    '@rspack/binding',
    '@rspack/binding-*',
    '@rspack/core',
    '@rspack/plugin-react-refresh',
    'ts-checker-rspack-plugin',
  ]);
  expect(readPnpmConfig(projectDir, 'trustPolicy')).toBe('no-downgrade');
  expect(readPnpmConfig(projectDir, 'trustPolicyIgnoreAfter')).toBe(1440);
  expect(readPnpmConfig(projectDir, 'trustPolicyExclude')).toEqual([
    `effect@${expectedEffectVersion}`,
    `@effect/opentelemetry@${expectedEffectVersion}`,
  ]);
  expect(readPnpmConfig(projectDir, 'blockExoticSubdeps')).toBe(true);
  expect(readPnpmConfig(projectDir, 'engineStrict')).toBe(true);
  expect(readPnpmConfig(projectDir, 'pmOnFail')).toBe('error');
  expect(readPnpmConfig(projectDir, 'verifyDepsBeforeRun')).toBe('error');
  expect(readPnpmConfig(projectDir, 'strictDepBuilds')).toBe(true);
}

function runCreate(cwd: string, args: string[]) {
  execFileSync(process.execPath, [createBin, ...args], {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION:
        expectedBleedingDevFrameworkVersion,
    },
    stdio: 'pipe',
  });
}

describe('create-tailwind', () => {
  let tempRoot = '';
  let withTailwindDir = '';
  let withoutTailwindDir = '';

  beforeAll(() => {
    rstest.setConfig({
      testTimeout: 1000 * 60 * 3,
      hookTimeout: 1000 * 60 * 3,
    });
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-create-tailwind-'),
    );
    withTailwindDir = path.join(tempRoot, 'with-tailwind');
    withoutTailwindDir = path.join(tempRoot, 'without-tailwind');
    runCreate(tempRoot, ['with-tailwind', '--lang', 'en']);
    runCreate(tempRoot, ['without-tailwind', '--no-tailwind', '--lang', 'en']);
  });

  afterAll(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scaffolds Tailwind v4 in the generated workspace by default', () => {
    const shellDir = path.join(withTailwindDir, shellAppPath);
    expect(fs.existsSync(path.join(shellDir, 'tailwind.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(shellDir, 'postcss.config.mjs'))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(shellDir, 'src/routes/[lang]/page.tsx')),
    ).toBe(true);

    const shellPackage = readJson(shellDir, 'package.json');
    expect(shellPackage.devDependencies.tailwindcss).toBe('^4.3.2');
    expect(shellPackage.devDependencies['@rsbuild/plugin-tailwindcss']).toBe(
      '^2.0.3',
    );
  });

  test('supports --no-tailwind opt-out', () => {
    const shellDir = path.join(withoutTailwindDir, shellAppPath);
    expect(fs.existsSync(path.join(shellDir, 'tailwind.config.ts'))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(shellDir, 'postcss.config.mjs'))).toBe(
      false,
    );

    const shellPackage = readJson(shellDir, 'package.json');
    expect(shellPackage.devDependencies.tailwindcss).toBeUndefined();
    expect(
      shellPackage.devDependencies['@rsbuild/plugin-tailwindcss'],
    ).toBeUndefined();
  });

  test('adds a Tailwind-enabled vertical to a Tailwind workspace', () => {
    runCreate(withTailwindDir, ['catalog', '--vertical', '--lang', 'en']);

    const verticalDir = path.join(withTailwindDir, 'verticals/catalog');
    expect(fs.existsSync(path.join(verticalDir, 'tailwind.config.ts'))).toBe(
      true,
    );
    const verticalPackage = readJson(verticalDir, 'package.json');
    expect(verticalPackage.devDependencies.tailwindcss).toBe('^4.3.2');
  });

  test('vertical inherits --no-tailwind workspace setting', () => {
    runCreate(withoutTailwindDir, ['billing', '--vertical', '--lang', 'en']);

    const verticalDir = path.join(withoutTailwindDir, 'verticals/billing');
    expect(fs.existsSync(path.join(verticalDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(verticalDir, 'tailwind.config.ts'))).toBe(
      false,
    );
    const verticalPackage = readJson(verticalDir, 'package.json');
    expect(verticalPackage.devDependencies.tailwindcss).toBeUndefined();
  });

  test('uses BleedingDev npm aliases for UltraModern package installs', () => {
    expect(
      fs.existsSync(
        path.join(withTailwindDir, '.modernjs/ultramodern-package-source.json'),
      ),
    ).toBe(false);

    const ultramodernConfig = readJson(
      withTailwindDir,
      '.modernjs/ultramodern.json',
    );
    expect(ultramodernConfig.packageSource.strategy).toBe('install');
    expect(ultramodernConfig.packageSource.modernPackageVersion).toBe(
      expectedBleedingDevFrameworkVersion,
    );
    expect(ultramodernConfig.packageSource.aliasScope).toBe('bleedingdev');
    expect(ultramodernConfig.packageSource.aliasPackageNamePrefix).toBe(
      'modern-js-',
    );

    const shellPackage = readJson(
      path.join(withTailwindDir, shellAppPath),
      'package.json',
    );
    expect(shellPackage.dependencies['@modern-js/runtime']).toBe(
      `npm:@bleedingdev/modern-js-runtime@${expectedBleedingDevFrameworkVersion}`,
    );
    expect(shellPackage.devDependencies['@modern-js/app-tools']).toBe(
      `npm:@bleedingdev/modern-js-app-tools@${expectedBleedingDevFrameworkVersion}`,
    );
  });

  test('pins the pnpm toolchain and hardening policy on the workspace root', () => {
    const rootPackage = readJson(withTailwindDir, 'package.json');
    const pnpmVersion = expectPnpm11OrNewerPackageManager(
      rootPackage.packageManager,
    );
    expect(rootPackage.engines.pnpm).toBe('>=11');
    expect(fs.existsSync(path.join(withTailwindDir, '.mise.toml'))).toBe(true);
    expect(
      fs.readFileSync(path.join(withTailwindDir, '.mise.toml'), 'utf-8'),
    ).toContain(`pnpm = "${pnpmVersion}"`);
    expectPnpm11Policy(withTailwindDir);
  });
});
