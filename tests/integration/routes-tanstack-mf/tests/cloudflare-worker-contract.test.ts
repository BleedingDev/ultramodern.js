/**
 * @jest-environment node
 */
import { existsSync } from 'node:fs';
import { access, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

setSuiteTimeout(1000 * 60 * 5);

const require = createRequire(import.meta.url);
const {
  modernBuild,
  runModernCommand,
} = require('../../../utils/modernTestUtils.js');
const fixtureRoot = path.resolve(__dirname, '..');
const appDir = path.join(fixtureRoot, 'mf-remote');
const outputDirectory = path.join(appDir, '.output');
const cloudflareEnvironment = {
  MF_HOST_ORIGIN: 'http://localhost:3011',
  MF_REMOTE_ORIGIN: 'http://localhost:3010',
  MF_REMOTE_PORT: '3010',
  MODERNJS_DEPLOY: 'cloudflare',
};
const ensureWorkspacePackages = [
  '@modern-js/app-tools',
  '@modern-js/bff-core',
  '@modern-js/create-request',
  '@modern-js/i18n-utils',
  '@modern-js/plugin',
  '@modern-js/plugin-bff',
  '@modern-js/plugin-tanstack',
  '@modern-js/prod-server',
  '@modern-js/runtime',
  '@modern-js/server',
  '@modern-js/server-core',
  '@modern-js/server-utils',
  '@modern-js/utils',
];

type CommandResult = {
  code: number | null;
  stderr?: string;
  stdout?: string;
};

// Anchored on quote boundaries so it never false-positives on
// '@tanstack/react-router' (the fork's supported router).
const BARE_REACT_ROUTER_SPECIFIER = /["'](react-router(-dom)?)(\/[^"']*)?["']/;
const REACT_ROUTER_NODE_MODULES_PATH = /node_modules\/react-router(-dom)?\b/;
const ROUTE_MODULE_DYNAMIC_IMPORT =
  /await import\(\s*(?:\/\*[\s\S]*?\*\/\s*)*route\.module\s*\)/;
const MF_DTS_FALLBACK_DIAGNOSTIC =
  /Failed to collect TypeScript dependency files with "tsc --listFilesOnly"; falling back to exposed files only|Module Federation DTS.*(?:Error|Failed)|TYPE-001|TS6059/iu;

const readZipEntryNames = async (archivePath: string): Promise<string[]> => {
  const archive = await readFile(archivePath);
  const minimumEocdOffset = Math.max(0, archive.length - 65_557);
  let eocdOffset = archive.length - 22;
  while (
    eocdOffset >= minimumEocdOffset &&
    archive.readUInt32LE(eocdOffset) !== 0x06054b50
  ) {
    eocdOffset -= 1;
  }
  expect(eocdOffset).toBeGreaterThanOrEqual(minimumEocdOffset);

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let entryOffset = archive.readUInt32LE(eocdOffset + 16);
  const entries: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    expect(archive.readUInt32LE(entryOffset)).toBe(0x02014b50);
    const fileNameLength = archive.readUInt16LE(entryOffset + 28);
    const extraLength = archive.readUInt16LE(entryOffset + 30);
    const commentLength = archive.readUInt16LE(entryOffset + 32);
    entries.push(
      archive
        .subarray(entryOffset + 46, entryOffset + 46 + fileNameLength)
        .toString('utf8'),
    );
    entryOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries.filter(entry => !entry.endsWith('/')).sort();
};

const collectFilesRecursively = async (root: string): Promise<string[]> => {
  let entries: Array<{ isDirectory: () => boolean; name: string }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(entryPath)));
    } else {
      files.push(entryPath);
    }
  }
  return files;
};

const assertNoReactRouterInWorkerModules = async (
  label: string,
  root: string,
): Promise<void> => {
  const files = await collectFilesRecursively(root);
  expect(files.length).toBeGreaterThan(0);
  for (const filePath of files) {
    if (REACT_ROUTER_NODE_MODULES_PATH.test(filePath)) {
      throw new Error(
        `${label}: file path resolves through node_modules/react-router: ${filePath}`,
      );
    }
    const source = await readFile(filePath, 'utf8');
    const specifierMatch = BARE_REACT_ROUTER_SPECIFIER.exec(source);
    if (specifierMatch) {
      throw new Error(
        `${label}: found bare react-router specifier "${specifierMatch[0]}" in ${filePath}`,
      );
    }
    if (REACT_ROUTER_NODE_MODULES_PATH.test(source)) {
      throw new Error(
        `${label}: found a node_modules/react-router path reference inside ${filePath}`,
      );
    }
    if (ROUTE_MODULE_DYNAMIC_IMPORT.test(source)) {
      throw new Error(
        `${label}: found a react-router-style "await import(route.module)" shape in ${filePath}`,
      );
    }
  }
};

// Walks the ancestor `node_modules` chain the way Node resolves a bare
// specifier. `require.resolve` cannot answer this here: the test file is
// bundled by the runner, so its `resolve` runs through the bundler resolver,
// which reaches into the monorepo's pnpm store and finds packages the app
// itself can never require.
// The walk stops at the monorepo root (the directory containing
// `pnpm-workspace.yaml`) so a react-router install in some ancestor outside
// the repo (e.g. a parent folder on a contributor's machine) can't fail
// this assertion.
const findInstalledPackage = (
  from: string,
  specifier: string,
): string | undefined => {
  let directory = from;
  for (;;) {
    const candidate = path.join(directory, 'node_modules', specifier);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (existsSync(path.join(directory, 'pnpm-workspace.yaml'))) {
      return undefined;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
};

const requireSuccessfulCommand = (
  label: string,
  result: CommandResult,
): void => {
  if (result.code === 0) {
    return;
  }

  throw new Error(
    `${label} failed with exit code ${String(result.code)}.\n${
      result.stdout ?? ''
    }\n${result.stderr ?? ''}`,
  );
};

describe('TanStack Module Federation Cloudflare worker contract', () => {
  let releaseFixtureLock: ReleaseFixtureLock | undefined;

  beforeAll(async () => {
    releaseFixtureLock = await acquireFixtureLock(fixtureRoot);
    await Promise.all([
      rm(path.join(appDir, 'dist-cloudflare'), {
        force: true,
        recursive: true,
      }),
      rm(outputDirectory, { force: true, recursive: true }),
      rm(path.join(appDir, 'node_modules/.modern-js-tanstack-mf-cloudflare'), {
        force: true,
        recursive: true,
      }),
    ]);
  });

  test('deploys the generated route and Effect workers through the production verifier', async () => {
    const buildResult = (await modernBuild(appDir, [], {
      ensureWorkspacePackages,
      env: cloudflareEnvironment,
    })) as CommandResult;
    requireSuccessfulCommand('Cloudflare build', buildResult);
    expect(
      `${buildResult.stdout ?? ''}\n${buildResult.stderr ?? ''}`,
    ).not.toMatch(MF_DTS_FALLBACK_DIAGNOSTIC);
    await expect(
      readZipEntryNames(path.join(appDir, 'dist-cloudflare/@mf-types.zip')),
    ).resolves.toEqual([
      'App.d.ts',
      'Mutator.d.ts',
      'Widget.d.ts',
      'compiled-types/src/components/Mutator.d.ts',
      'compiled-types/src/components/RuntimeApp.d.ts',
      'compiled-types/src/components/Widget.d.ts',
      'compiled-types/src/modern-tanstack/index/router.gen.d.ts',
      'compiled-types/src/routes/layout.d.ts',
      'compiled-types/src/routes/page.d.ts',
    ]);

    const deployResult = (await runModernCommand(['deploy', '--skip-build'], {
      cwd: appDir,
      ensureWorkspacePackages,
      env: {
        ...cloudflareEnvironment,
        NODE_ENV: 'production',
      },
      stderr: true,
      stdout: true,
    })) as CommandResult;
    requireSuccessfulCommand('Cloudflare deploy verification', deployResult);

    const manifest = JSON.parse(
      await readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf8',
      ),
    ) as {
      routeSpec?: {
        routes?: Array<{
          entryName?: string;
          worker?: string;
          workerExists?: boolean;
        }>;
      };
      bff?: {
        dispatcherExport?: string;
        prefix?: string;
        runtimeFramework?: string;
        worker?: string;
      };
    };

    expect(manifest.routeSpec?.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryName: 'index',
          worker: 'worker/index.js',
          workerExists: true,
        }),
      ]),
    );
    expect(manifest.bff).toEqual(
      expect.objectContaining({
        dispatcherExport: '__modern_create_effect_bff_dispatcher',
        prefix: '/remote-api',
        runtimeFramework: 'effect',
        worker: 'worker/__modern_bff_effect.js',
      }),
    );
    await Promise.all(
      [
        'worker/index.js',
        'worker/__modern_bff_effect.js',
        'worker/__modern_worker_runtime.js',
      ].map(worker => access(path.join(outputDirectory, worker))),
    );

    // TanStack-only apps need no react-router: the fixture's own manifest
    // must never declare it, and it must not be resolvable from the app
    // directory (proving nothing hoisted/aliased it in either).
    const appPackageJson = JSON.parse(
      await readFile(path.join(appDir, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const reactRouterPackage of ['react-router', 'react-router-dom']) {
      expect(appPackageJson.dependencies ?? {}).not.toHaveProperty(
        reactRouterPackage,
      );
      expect(appPackageJson.devDependencies ?? {}).not.toHaveProperty(
        reactRouterPackage,
      );
    }
    for (const reactRouterPackage of ['react-router', 'react-router-dom']) {
      expect(findInstalledPackage(appDir, reactRouterPackage)).toBeUndefined();
    }

    // Module-graph level: walk the exact worker output the production
    // verifier walks and assert no react-router specifier, node_modules
    // path, or react-router-style route.module dynamic import shape
    // survives into the deployed Cloudflare worker closure.
    await assertNoReactRouterInWorkerModules(
      'Cloudflare worker output',
      path.join(outputDirectory, 'worker'),
    );
  });

  afterAll(async () => {
    try {
      await Promise.all([
        rm(path.join(appDir, 'dist-cloudflare'), {
          force: true,
          recursive: true,
        }),
        rm(outputDirectory, { force: true, recursive: true }),
        rm(
          path.join(appDir, 'node_modules/.modern-js-tanstack-mf-cloudflare'),
          {
            force: true,
            recursive: true,
          },
        ),
      ]);
    } finally {
      await releaseFixtureLock?.();
    }
  });
});
