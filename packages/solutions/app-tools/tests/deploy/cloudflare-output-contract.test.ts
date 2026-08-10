import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudflarePreset } from '../../src/plugins/deploy/platforms/cloudflare/index';
import { verifyCloudflareOutput } from '../../src/plugins/deploy/platforms/cloudflare-output-verifier/index';

const tempDirectories: string[] = [];

const writeFile = async (root: string, filename: string, content: string) => {
  const filePath = path.join(root, filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
};

const writeJson = async (root: string, filename: string, value: unknown) =>
  writeFile(root, filename, `${JSON.stringify(value, null, 2)}\n`);

const createCloudflareDeployOutput = async () => {
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-cloudflare-output-contract-'),
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
    'globalThis.appLoaded = true;\n',
  );
  await writeFile(
    distDirectory,
    'static/app.css',
    'body { color: #123456; }\n',
  );
  await writeFile(
    distDirectory,
    'worker/main.js',
    `exports.requestHandler = function requestHandler() { return new Response('fixture worker'); };\n`,
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
    name: 'cloudflare-output-contract',
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
    `/*\n  X-Frame-Options: DENY\n\n/static/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
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
          name: 'modern-cloudflare-output-contract',
          wrangler: {
            observability: { enabled: true },
            vars: { FEATURE_FLAG: 'contract' },
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

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('cloudflare deploy output contract', () => {
  it('emits a verifiable package whose worker and assets execute', async () => {
    const outputDirectory = await createCloudflareDeployOutput();
    await expect(verifyCloudflareOutput({ outputDirectory })).resolves.toEqual({
      ok: true,
      issues: [],
    });

    const worker = (
      await import(
        `${pathToFileURL(path.join(outputDirectory, 'server/index.mjs')).href}?t=${Date.now()}`
      )
    ).default;
    const assets = {
      fetch: async (request: Request) => {
        const assetPath = path.join(
          outputDirectory,
          'public',
          new URL(request.url).pathname,
        );
        try {
          return new Response(await fs.readFile(assetPath));
        } catch {
          return new Response('missing', { status: 404 });
        }
      },
    };

    const ssrResponse = await worker.fetch(
      new Request('https://example.com/'),
      { ASSETS: assets },
    );
    expect(ssrResponse.status).toBe(200);
    await expect(ssrResponse.text()).resolves.toBe('fixture worker');

    const staticResponse = await worker.fetch(
      new Request('https://example.com/static/app.js'),
      { ASSETS: assets },
    );
    expect(staticResponse.status).toBe(200);
    expect(await staticResponse.text()).toBe('globalThis.appLoaded = true;\n');

    const wrangler = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf8'),
    );
    expect(wrangler).toMatchObject({
      main: 'server/index.mjs',
      observability: { enabled: true },
      vars: { FEATURE_FLAG: 'contract' },
    });
  });
});
