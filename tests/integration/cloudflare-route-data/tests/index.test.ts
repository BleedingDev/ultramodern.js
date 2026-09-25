/**
 * @jest-environment node
 */
import { readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from 'miniflare';
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
const appDir = path.resolve(__dirname, '..');
const outputDirectory = path.join(appDir, '.output');
const cloudflareEnvironment = { MODERNJS_DEPLOY: 'cloudflare' };
const requiredWorkspacePackages = [
  '@modern-js/app-tools',
  '@modern-js/app-tools-extensions',
  '@modern-js/plugin-tanstack',
  '@modern-js/runtime',
  '@modern-js/ultramodern-app-tools',
];

type CommandResult = {
  code: number | null;
  stderr?: string;
  stdout?: string;
};

const requireSuccessfulCommand = (label: string, result: CommandResult) => {
  if (result.code !== 0) {
    throw new Error(
      `${label} failed with exit code ${String(result.code)}.\n${
        result.stdout ?? ''
      }\n${result.stderr ?? ''}`,
    );
  }
};

const listWorkerModules = async (directory: string): Promise<string[]> =>
  (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(?:c|m)?js$/u.test(entry.name))
    .map(entry => path.join(entry.parentPath, entry.name))
    .sort();

const startWorker = async () => {
  const wrangler = JSON.parse(
    await readFile(path.join(outputDirectory, 'wrangler.json'), 'utf8'),
  ) as {
    assets: { binding: string; directory: string };
    compatibility_date: string;
    compatibility_flags?: string[];
    main: string;
    name: string;
  };
  const main = path.join(outputDirectory, wrangler.main);
  const modulePaths = [
    main,
    ...(await listWorkerModules(path.join(outputDirectory, 'server'))),
    ...(await listWorkerModules(path.join(outputDirectory, 'worker'))),
  ].filter((modulePath, index, paths) => paths.indexOf(modulePath) === index);

  return new Miniflare(
    convertV4MiniflareOptions({
      log: new Log(LogLevel.ERROR),
      workers: [
        {
          name: wrangler.name,
          modules: modulePaths.map(modulePath => ({
            path: modulePath,
            type: modulePath.endsWith('.cjs') ? 'CommonJS' : 'ESModule',
          })),
          modulesRoot: outputDirectory,
          compatibilityDate: wrangler.compatibility_date,
          compatibilityFlags: wrangler.compatibility_flags,
          assets: {
            binding: wrangler.assets.binding,
            directory: path.resolve(outputDirectory, wrangler.assets.directory),
            routerConfig: {
              has_user_worker: true,
              invoke_user_worker_ahead_of_assets: true,
            },
          },
        },
      ],
    }),
  );
};

describe('Cloudflare worker route data loaders', () => {
  let releaseFixtureLock: ReleaseFixtureLock | undefined;
  let worker: Miniflare | undefined;

  const request = async (pathname: string) => {
    const response = await worker!.dispatchFetch(
      `http://localhost${pathname}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    return { response, body: await response.text() };
  };

  beforeAll(async () => {
    releaseFixtureLock = await acquireFixtureLock(appDir);
    await Promise.all(
      ['dist', '.output'].map(directory =>
        rm(path.join(appDir, directory), { force: true, recursive: true }),
      ),
    );

    requireSuccessfulCommand(
      'Cloudflare build',
      (await modernBuild(appDir, [], {
        requiredWorkspacePackages,
        env: cloudflareEnvironment,
      })) as CommandResult,
    );
    requireSuccessfulCommand(
      'Cloudflare deploy verification',
      (await runModernCommand(['deploy', '--skip-build'], {
        cwd: appDir,
        requiredWorkspacePackages,
        env: { ...cloudflareEnvironment, NODE_ENV: 'production' },
        stderr: true,
        stdout: true,
      })) as CommandResult,
    );
    worker = await startWorker();
  });

  afterAll(async () => {
    try {
      await worker?.dispose();
      await Promise.all(
        ['dist', '.output'].map(directory =>
          rm(path.join(appDir, directory), { force: true, recursive: true }),
        ),
      );
    } finally {
      await releaseFixtureLock?.();
    }
  });

  test('publishes the route data worker in the manifest', async () => {
    const manifest = JSON.parse(
      await readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf8',
      ),
    ) as { routeSpec: { routes: Array<Record<string, unknown>> } };

    expect(manifest.routeSpec.routes).toEqual([
      expect.objectContaining({
        entryName: 'index',
        routeDataWorker: 'worker/index-server-loaders.js',
        worker: 'worker/index.js',
        workerExists: true,
      }),
    ]);
  });

  test('server-renders loader routes in workerd with in-process loaders', async () => {
    const index = await request('/');
    expect(index.response.status).toBe(200);
    expect(index.body).toMatch(
      /<div id="index">worker-index:(?:<!-- -->)?index</u,
    );

    const user = await request('/user/42');
    expect(user.response.status).toBe(200);
    expect(user.body).toMatch(/<div id="user">worker-user:(?:<!-- -->)?42</u);
  });

  test('answers client route data requests from the route data worker', async () => {
    const user = await request(
      `/user/42?__loader=${encodeURIComponent('user/(id)/page')}`,
    );
    expect(user.response.status).toBe(200);
    expect(user.response.headers.get('X-Modernjs-Response')).toBe('yes');
    expect(user.body).toContain('{"id":"42"}');

    const index = await request('/?__loader=page');
    expect(index.response.status).toBe(200);
    expect(index.response.headers.get('X-Modernjs-Response')).toBe('yes');
    expect(index.body).toContain('{"page":"index"}');
  });
});
