#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const defaultCreatePackage = '@bleedingdev/modern-js-create@latest';
const defaultProjectName = 'ultramodern-ci-superapp';
const defaultSingleAppProjectName = 'ultramodern-ci-single-app';
const defaultOut = '.modern/production-readiness/published-create-proof.json';
const browserSmokeScript = path.join(
  repoRoot,
  'scripts/ultramodern-production-readiness/run-browser-smoke.mjs',
);
const browserSmokePlaywrightPackage =
  process.env.ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_PACKAGE ??
  'playwright@1.60.0';
const verticalNames = [
  'inventory',
  'finance',
  'people',
  'analytics',
  'orders',
  'procurement',
  'billing',
  'logistics',
  'support',
  'compliance',
];
const modernPackages = [
  '@modern-js/app-tools',
  '@modern-js/adapter-rstest',
  '@modern-js/plugin-bff',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/runtime',
  '@modern-js/tsconfig',
];
const workspaceModernPackages = [
  '@modern-js/app-tools',
  '@modern-js/plugin-bff',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/runtime',
];

function parseArgs(argv) {
  const options = {
    createPackage: defaultCreatePackage,
    projectName: defaultProjectName,
    singleAppProjectName: defaultSingleAppProjectName,
    verticalCount: 3,
    out: defaultOut,
    deployCloudflare: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--create-package') {
      options.createPackage = argv[++index];
    } else if (arg === '--project-name') {
      options.projectName = argv[++index];
    } else if (arg === '--single-app-project-name') {
      options.singleAppProjectName = argv[++index];
    } else if (arg === '--vertical-count') {
      options.verticalCount = Number.parseInt(argv[++index], 10);
    } else if (arg === '--out') {
      options.out = argv[++index];
    } else if (arg === '--deploy-cloudflare') {
      options.deployCloudflare = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.verticalCount) || options.verticalCount < 0) {
    throw new Error('--vertical-count must be a non-negative integer');
  }
  if (options.verticalCount > verticalNames.length) {
    throw new Error(`--vertical-count cannot exceed ${verticalNames.length}`);
  }
  assertSafeName(options.projectName, '--project-name');
  assertSafeName(options.singleAppProjectName, '--single-app-project-name');

  return {
    ...options,
    out: path.resolve(repoRoot, options.out),
    verticals: verticalNames.slice(0, options.verticalCount),
  };
}

function assertSafeName(value, optionName) {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new Error(`${optionName} must match /^[a-z][a-z0-9-]*$/`);
  }
}

function packageNameFromSpecifier(specifier) {
  const lastAt = specifier.lastIndexOf('@');
  if (specifier.startsWith('@') && lastAt > 0) {
    return specifier.slice(0, lastAt);
  }
  if (!specifier.startsWith('@') && lastAt > -1) {
    return specifier.slice(0, lastAt);
  }
  return specifier;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      ...options.env,
      FORCE_COLOR: '0',
    },
    encoding: 'utf-8',
    stdio: options.stdio || 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(' ')}`);
  }
  return result.stdout?.trim() ?? '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveCreatePackage(specifier) {
  const packageName = packageNameFromSpecifier(specifier);
  const version = JSON.parse(
    run('npm', ['view', specifier, 'version', '--json'], { stdio: 'pipe' }),
  );
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Could not resolve npm version for ${specifier}`);
  }
  return {
    packageName,
    version,
    exactSpecifier: `${packageName}@${version}`,
  };
}

function bleedingdevAlias(modernPackageName) {
  return `@bleedingdev/modern-js-${modernPackageName.split('/').at(-1)}`;
}

function expectedSpecifier(modernPackageName, version) {
  return `npm:${bleedingdevAlias(modernPackageName)}@${version}`;
}

function packageJsonFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['.git', '.output', 'dist', 'node_modules'].includes(entry.name)) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
      } else if (entry.name === 'package.json') {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function assertGeneratedCohort(
  projectDir,
  expectedVersion,
  { manifestPath, modernPackageNames, workspaceManifest = false } = {
    manifestPath: '.modernjs/mv-template-manifest.json',
    modernPackageNames: modernPackages,
    workspaceManifest: false,
  },
) {
  const errors = [];
  const packageSource = readJson(
    path.join(projectDir, '.modernjs/ultramodern-package-source.json'),
  );
  const manifest = readJson(path.join(projectDir, manifestPath));

  if (packageSource.strategy !== 'install') {
    errors.push(`package source strategy is ${packageSource.strategy}`);
  }
  if (packageSource.modernPackages?.specifier !== expectedVersion) {
    errors.push(
      `package source specifier is ${packageSource.modernPackages?.specifier}`,
    );
  }
  if (manifest.template?.version !== expectedVersion) {
    errors.push(`template version is ${manifest.template?.version}`);
  }
  if (
    workspaceManifest &&
    manifest.packageSource?.modernPackageSpecifier !== expectedVersion
  ) {
    errors.push(
      `manifest package specifier is ${manifest.packageSource?.modernPackageSpecifier}`,
    );
  }

  for (const modernPackageName of modernPackageNames) {
    const alias = packageSource.modernPackages?.aliases?.[modernPackageName];
    const expectedAlias = bleedingdevAlias(modernPackageName);
    if (alias !== expectedAlias) {
      errors.push(`${modernPackageName} alias is ${alias}`);
    }
  }

  for (const packageJsonPath of packageJsonFiles(projectDir)) {
    const relative = path.relative(projectDir, packageJsonPath);
    const packageJson = readJson(packageJsonPath);
    for (const section of ['dependencies', 'devDependencies']) {
      for (const modernPackageName of modernPackageNames) {
        const actual = packageJson[section]?.[modernPackageName];
        const expected = expectedSpecifier(modernPackageName, expectedVersion);
        if (actual !== undefined && actual !== expected) {
          errors.push(
            `${relative} ${section}.${modernPackageName} is ${actual}`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.map(error => `- ${error}`).join('\n'));
  }
}

function createWorkspace(workDir, projectName, createPackage) {
  run(
    'pnpm',
    [
      'dlx',
      createPackage.exactSpecifier,
      projectName,
      '--ultramodern-workspace',
      '--lang',
      'en',
    ],
    { cwd: workDir },
  );
}

function createSingleApp(workDir, projectName, createPackage) {
  run(
    'pnpm',
    [
      'dlx',
      createPackage.exactSpecifier,
      projectName,
      '--router',
      'tanstack',
      '--bff-runtime',
      'effect',
      '--lang',
      'en',
    ],
    { cwd: workDir },
  );
}

function addVertical(projectDir, vertical, createPackage) {
  run(
    'pnpm',
    [
      'dlx',
      createPackage.exactSpecifier,
      vertical,
      '--vertical',
      '--lang',
      'en',
    ],
    { cwd: projectDir },
  );
}

function playwrightRuntimeDir() {
  const digest = crypto
    .createHash('sha256')
    .update(browserSmokePlaywrightPackage)
    .digest('hex')
    .slice(0, 12);
  return path.join(os.tmpdir(), `ultramodern-browser-smoke-${digest}`);
}

function ensureBrowserSmokeRuntime() {
  const runtimeDir = playwrightRuntimeDir();
  const packageJsonPath = path.join(
    runtimeDir,
    'node_modules/playwright/package.json',
  );
  if (fs.existsSync(packageJsonPath)) {
    return runtimeDir;
  }

  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      browserSmokePlaywrightPackage,
    ],
    { cwd: runtimeDir },
  );
  return runtimeDir;
}

function runBrowserSmoke(projectDir, { mode, requirePublicUrls = false }) {
  const artifactDir = `.modern/production-readiness/browser-smoke/${mode}`;
  const out = `.modern/production-readiness/browser-smoke/${mode}-summary.json`;
  const runtimeDir = ensureBrowserSmokeRuntime();
  const args = [
    'node',
    browserSmokeScript,
    '--project-dir',
    projectDir,
    '--artifact-dir',
    artifactDir,
    '--out',
    out,
    '--mode',
    mode,
  ];

  if (requirePublicUrls) {
    args.push('--require-public-urls');
  }

  run(args[0], args.slice(1), {
    env: {
      ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_ROOT: runtimeDir,
    },
  });
  return readJson(path.resolve(repoRoot, out));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const createPackage = resolveCreatePackage(options.createPackage);
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-production-readiness-'),
  );
  const projectDir = path.join(workDir, options.projectName);
  const singleAppDir = path.join(workDir, options.singleAppProjectName);
  const summary = {
    schemaVersion: 1,
    createPackage,
    projectDir,
    singleAppDir,
    verticals: options.verticals,
    checks: [],
  };

  try {
    createSingleApp(workDir, options.singleAppProjectName, createPackage);
    assertGeneratedCohort(singleAppDir, createPackage.version, {
      manifestPath: '.modernjs/mv-template-manifest.json',
      modernPackageNames: modernPackages,
    });
    summary.checks.push('single-app-published-cohort-alignment');

    createWorkspace(workDir, options.projectName, createPackage);
    for (const vertical of options.verticals) {
      addVertical(projectDir, vertical, createPackage);
    }

    assertGeneratedCohort(projectDir, createPackage.version, {
      manifestPath: '.modernjs/ultramodern-workspace-template-manifest.json',
      modernPackageNames: workspaceModernPackages,
      workspaceManifest: true,
    });
    summary.checks.push('workspace-published-cohort-alignment');

    run('pnpm', ['install'], { cwd: projectDir });
    summary.checks.push('install');

    run('pnpm', ['check'], { cwd: projectDir });
    summary.checks.push('check');

    run('pnpm', ['build'], { cwd: projectDir });
    summary.checks.push('build');

    summary.browserSmoke = {
      local: runBrowserSmoke(projectDir, { mode: 'local' }),
    };
    summary.checks.push('browser-smoke-local');

    if (options.deployCloudflare) {
      run('pnpm', ['cloudflare:deploy'], { cwd: projectDir });
      run('pnpm', ['cloudflare:proof', '--', '--require-public-urls'], {
        cwd: projectDir,
      });
      summary.browserSmoke.public = runBrowserSmoke(projectDir, {
        mode: 'public',
        requirePublicUrls: true,
      });
      summary.checks.push('cloudflare-deploy-proof');
      summary.checks.push('browser-smoke-public');
    }

    summary.ok = true;
    writeJson(options.out, summary);
    console.log(`[ultramodern-production-readiness] pass: ${options.out}`);
  } catch (error) {
    summary.ok = false;
    summary.error = error instanceof Error ? error.message : String(error);
    writeJson(options.out, summary);
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
