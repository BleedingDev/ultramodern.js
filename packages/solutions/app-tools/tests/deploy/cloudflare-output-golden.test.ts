import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCloudflarePreset } from '../../src/plugins/deploy/platforms/cloudflare';

const tempDirectories: string[] = [];

const goldenDirectory = path.resolve(
  __dirname,
  '../fixtures/cloudflare/deploy-output-golden',
);

const goldenFiles = [
  'wrangler.json',
  'package.json',
  'worker/package.json',
  'server/index.mjs',
  'server/modern-worker-manifest.json',
  'server/route.json',
  'public/_headers',
  'public/_routes.json',
] as const;

const updateGolden = process.env.UPDATE_CLOUDFLARE_DEPLOY_OUTPUT_GOLDEN === '1';

const writeFile = async (root: string, filename: string, content: string) => {
  const filePath = path.join(root, filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
};

const writeJson = async (root: string, filename: string, value: unknown) =>
  writeFile(root, filename, `${JSON.stringify(value, null, 2)}\n`);

const getOutputPath = (root: string, relativePath: string) =>
  path.join(root, relativePath);

const getGoldenPath = (relativePath: string) =>
  path.join(goldenDirectory, `${relativePath}.golden`);

const createCloudflareDeployOutput = async () => {
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-cloudflare-output-golden-'),
  );
  tempDirectories.push(appDirectory);

  const distDirectory = path.join(appDirectory, 'dist');

  await writeFile(
    distDirectory,
    'html/main/index.html',
    '<!doctype html><html><head></head><body>main</body></html>',
  );
  await writeFile(
    distDirectory,
    'html/plain/index.html',
    '<!doctype html><html><head></head><body>plain</body></html>',
  );
  await writeFile(
    distDirectory,
    'static/app.js',
    'globalThis.__goldenFixture = true;\n',
  );
  await writeFile(
    distDirectory,
    'static/app.css',
    'body { color: #123456; }\n',
  );
  await writeFile(
    distDirectory,
    'worker/main.js',
    [
      'export function requestHandler() {',
      "  return new Response('fixture worker');",
      '}',
      '',
    ].join('\n'),
  );
  await writeJson(distDirectory, 'routes-manifest.json', {
    routeAssets: {
      main: {
        assets: ['static/app.js', 'static/app.css'],
        referenceCssAssets: ['static/app.css'],
      },
    },
  });
  await writeJson(distDirectory, 'loadable-stats.json', {
    name: 'cloudflare-output-golden',
  });
  await writeJson(distDirectory, 'route.json', {
    routes: [
      {
        urlPath: '/',
        entryName: 'main',
        entryPath: 'html/main/index.html',
        isSSR: true,
        worker: 'worker/main.js',
        bundle: 'bundles/main.js',
      },
      {
        urlPath: '/plain',
        entryName: 'plain',
        entryPath: 'html/plain/index.html',
        isSSR: false,
      },
    ],
  });
  await writeFile(
    distDirectory,
    '_headers',
    [
      '/*',
      '  X-Frame-Options: DENY',
      '',
      '/static/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
    ].join('\n'),
  );
  await writeJson(distDirectory, '_routes.json', {
    version: 1,
    include: ['/*'],
    exclude: ['/static/*'],
  });

  const preset = createCloudflarePreset({
    appContext: {
      appDirectory,
      distDirectory,
      serverPlugins: [],
    } as any,
    modernConfig: {
      deploy: {
        worker: {
          compatibilityDate: '2026-06-02',
          name: 'modern-cloudflare-output-golden',
          security: {
            contentSecurityPolicy: {
              mode: 'enforce',
              additionalConnectSrc: ['https://api.example.com'],
              frameAncestors: ["'self'", 'https://portal.example.com'],
              reason: 'golden fixture exercises security header output',
            },
            headers: {
              permissionsPolicy: 'camera=(), geolocation=()',
            },
            noindex: {
              workersDev: false,
              localhost: false,
              previewHostnames: ['preview.example.com'],
              reason: 'golden fixture exercises x-robots-tag output',
            },
          },
          wrangler: {
            observability: {
              enabled: true,
            },
            vars: {
              FEATURE_FLAG: 'golden',
            },
          },
        },
      },
    } as any,
    api: {} as any,
  });

  await preset.prepare?.();
  await preset.writeOutput?.();
  await preset.genEntry?.();

  return path.join(appDirectory, '.output');
};

const firstDifferentByte = (actual: Buffer, expected: Buffer) => {
  const length = Math.min(actual.length, expected.length);

  for (let index = 0; index < length; index++) {
    if (actual[index] !== expected[index]) {
      return index;
    }
  }

  return actual.length === expected.length ? -1 : length;
};

const expectGoldenFilesEqual = async (
  actualRoot: string,
  getExpectedPath: (relativePath: string) => string,
  label: string,
) => {
  for (const relativePath of goldenFiles) {
    const actual = await fs.readFile(path.join(actualRoot, relativePath));
    const expected = await fs.readFile(getExpectedPath(relativePath));

    if (!actual.equals(expected)) {
      const byte = firstDifferentByte(actual, expected);
      throw new Error(
        `${label}: ${relativePath} differs at byte ${byte} ` +
          `(actual ${actual.length} bytes, expected ${expected.length} bytes)`,
      );
    }
  }
};

const updateGoldenFiles = async (outputDirectory: string) => {
  for (const relativePath of goldenFiles) {
    await fs.mkdir(path.dirname(getGoldenPath(relativePath)), {
      recursive: true,
    });
    await fs.copyFile(
      path.join(outputDirectory, relativePath),
      getGoldenPath(relativePath),
    );
  }
};

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(directory =>
      fs.rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('cloudflare deploy output golden', () => {
  it('emits deterministic deploy output matching the checked-in golden', async () => {
    const firstOutputDirectory = await createCloudflareDeployOutput();
    const secondOutputDirectory = await createCloudflareDeployOutput();

    await expectGoldenFilesEqual(
      secondOutputDirectory,
      relativePath => getOutputPath(firstOutputDirectory, relativePath),
      'Cloudflare deploy output is not deterministic',
    );

    if (updateGolden) {
      await updateGoldenFiles(firstOutputDirectory);
    }

    await expectGoldenFilesEqual(
      firstOutputDirectory,
      getGoldenPath,
      'Cloudflare deploy output golden drift',
    );
  });
});
