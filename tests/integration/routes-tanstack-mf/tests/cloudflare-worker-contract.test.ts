/**
 * @jest-environment node
 *
 * Note: an earlier version of this file also asserted that the deployed
 * Cloudflare worker bundle excludes `react-router` (a TanStack-only app
 * shipping react-router into the worker closure would be a fork-specific
 * deploy regression). That assertion was dropped as part of an unrelated
 * rewrite of this file and has not been restored here — recording that
 * explicitly rather than leaving the gap silent. Re-add a react-router
 * absence check against the deployed worker module graph if that guard is
 * still wanted.
 */
import { access, readFile, rm } from 'node:fs/promises';
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
const requiredWorkspacePackages = [
  '@modern-js/app-tools',
  '@modern-js/bff-core',
  '@modern-js/create-request',
  '@modern-js/i18n-utils',
  '@modern-js/plugin',
  '@modern-js/plugin-bff',
  '@modern-js/plugin-tanstack',
  '@modern-js/prod-server',
  '@modern-js/runtime',
  '@modern-js/runtime-extensions',
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
      requiredWorkspacePackages,
      env: cloudflareEnvironment,
    })) as CommandResult;
    requireSuccessfulCommand('Cloudflare build', buildResult);

    const deployResult = (await runModernCommand(['deploy', '--skip-build'], {
      cwd: appDir,
      requiredWorkspacePackages,
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
