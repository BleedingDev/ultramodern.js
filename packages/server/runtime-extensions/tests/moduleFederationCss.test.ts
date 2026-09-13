import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  collectDirectRemoteModuleFederationCssWithMeta,
  collectModuleFederationManifestCss,
  createModuleFederationCssCollector,
} from '../src/module-federation-css';

const listen = async (server: Server) => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${String(port)}`;
};

const closeServer = (server: Server) =>
  new Promise<void>(resolve => server.close(() => resolve()));

const tempDirs: string[] = [];

const createTempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'modern-mf-css-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('module federation css collection', () => {
  it('resolves manifest css against publicPath and dedupes assets', () => {
    const css = collectModuleFederationManifestCss(
      {
        metaData: {
          publicPath: 'https://cdn.example.com/remote',
        },
        shared: [
          {
            assets: {
              css: {
                sync: ['static/css/shared.css'],
                async: ['static/css/shared.css', '/root.css'],
              },
            },
          },
        ],
        exposes: [
          {
            assets: {
              css: {
                sync: ['static/css/expose.css'],
                async: ['https://assets.example.com/async.css'],
              },
            },
          },
        ],
        remotes: [
          {
            assets: {
              css: {
                sync: ['static/css/nested-remote.css'],
              },
            },
          },
        ],
      },
      'https://origin.example.com/mf-manifest.json',
    );

    expect(css).toEqual([
      'https://cdn.example.com/remote/static/css/shared.css',
      'https://cdn.example.com/root.css',
      'https://cdn.example.com/remote/static/css/expose.css',
      'https://assets.example.com/async.css',
    ]);
  });

  it('resolves publicPath variants without localhost or doubled static prefixes', () => {
    const cases = [
      {
        publicPath: '/',
        expected: 'https://remote.example.com/static/css/main.css',
      },
      {
        publicPath: '/static-base',
        expected: 'https://remote.example.com/static-base/static/css/main.css',
      },
      {
        publicPath: '/static-base/',
        expected: 'https://remote.example.com/static-base/static/css/main.css',
      },
      {
        publicPath: 'https://cdn.example.com/assets',
        expected: 'https://cdn.example.com/assets/static/css/main.css',
      },
      {
        publicPath: 'https://cdn.example.com/assets/',
        expected: 'https://cdn.example.com/assets/static/css/main.css',
      },
    ];

    for (const { publicPath, expected } of cases) {
      const css = collectModuleFederationManifestCss(
        {
          metaData: {
            publicPath,
          },
          exposes: [
            {
              assets: {
                css: {
                  sync: ['static/css/main.css'],
                },
              },
            },
          ],
        },
        'https://remote.example.com/nested/mf-manifest.json',
      );

      expect(css).toEqual([expected]);
      expect(css[0]).not.toContain('localhost');
      expect(css[0]).not.toContain('//static');
    }
  });

  it('falls back to the remote manifest URL when publicPath is absent', () => {
    const css = collectModuleFederationManifestCss(
      {
        exposes: [
          {
            assets: {
              css: {
                sync: ['static/css/expose.css', '/root.css'],
              },
            },
          },
        ],
      },
      'http://localhost:3010/nested/mf-manifest.json',
    );

    expect(css).toEqual([
      'http://localhost:3010/nested/static/css/expose.css',
      'http://localhost:3010/root.css',
    ]);
  });

  it('loads available remote CSS and marks partial remote failures', async () => {
    const pwd = await createTempDir();
    await writeFile(
      path.join(pwd, 'mf-manifest.json'),
      JSON.stringify({
        remotes: [
          {
            entry: 'remoteA@https://remote-a.example.com/mf-manifest.json',
          },
          {
            entry: 'https://remote-b.example.com/mf-manifest.json',
          },
        ],
      }),
    );

    const warn = rs.fn();
    const fetcher = rs.fn(async (url: string) => {
      if (url.includes('remote-b')) {
        return new Response('missing', { status: 404 });
      }

      return Response.json({
        metaData: {
          publicPath: 'https://cdn.example.com/a/',
        },
        shared: [
          {
            assets: {
              css: {
                sync: ['static/css/shared.css'],
              },
            },
          },
        ],
        exposes: [
          {
            assets: {
              css: {
                sync: ['static/css/expose.css'],
                async: ['static/css/shared.css'],
              },
            },
          },
        ],
      });
    });

    const result = await collectDirectRemoteModuleFederationCssWithMeta(pwd, {
      fetcher,
      monitors: {
        warn,
      } as any,
    });

    expect(result.assets).toEqual([
      'https://cdn.example.com/a/static/css/shared.css',
      'https://cdn.example.com/a/static/css/expose.css',
    ]);
    expect(result.errored).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('module federation css native fetch redirect policy', () => {
  it('never contacts a redirect destination and marks the remote errored', async () => {
    const servers: Server[] = [];
    try {
      let destinationHits = 0;
      const destinationServer = createServer((_req, res) => {
        destinationHits += 1;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ exposes: [] }));
      });
      servers.push(destinationServer);
      const destinationOrigin = await listen(destinationServer);

      const redirectServer = createServer((_req, res) => {
        res.statusCode = 302;
        res.setHeader('location', `${destinationOrigin}/mf-manifest.json`);
        res.end();
      });
      servers.push(redirectServer);
      const redirectOrigin = await listen(redirectServer);

      const pwd = await createTempDir();
      await writeFile(
        path.join(pwd, 'mf-manifest.json'),
        JSON.stringify({
          remotes: [{ entry: `${redirectOrigin}/mf-manifest.json` }],
        }),
      );

      const warn = rs.fn();
      const result = await collectDirectRemoteModuleFederationCssWithMeta(pwd, {
        monitors: { warn } as any,
      });

      expect(result.assets).toEqual([]);
      expect(result.errored).toBe(true);
      expect(destinationHits).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      await Promise.all(servers.map(closeServer));
    }
  });

  it('still collects CSS from a direct loopback manifest (safe direct control)', async () => {
    const servers: Server[] = [];
    try {
      const directServer = createServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            metaData: { publicPath: 'https://cdn.example.com/direct/' },
            exposes: [
              {
                assets: {
                  css: { sync: ['static/css/direct.css'] },
                },
              },
            ],
          }),
        );
      });
      servers.push(directServer);
      const directOrigin = await listen(directServer);

      const pwd = await createTempDir();
      await writeFile(
        path.join(pwd, 'mf-manifest.json'),
        JSON.stringify({
          remotes: [{ entry: `${directOrigin}/mf-manifest.json` }],
        }),
      );

      const result = await collectDirectRemoteModuleFederationCssWithMeta(pwd);

      expect(result.assets).toEqual([
        'https://cdn.example.com/direct/static/css/direct.css',
      ]);
      expect(result.errored).toBe(false);
    } finally {
      await Promise.all(servers.map(closeServer));
    }
  });
});

describe('module federation css collector cache', () => {
  const writeHostManifest = async () => {
    const pwd = await createTempDir();
    await writeFile(
      path.join(pwd, 'mf-manifest.json'),
      JSON.stringify({
        remotes: [
          {
            entry: 'https://remote-a.example.com/mf-manifest.json',
          },
        ],
      }),
    );
    return pwd;
  };

  const remoteManifestWithCss = (cssAsset: string) =>
    Response.json({
      metaData: {
        publicPath: 'https://cdn.example.com/a/',
      },
      exposes: [
        {
          assets: {
            css: {
              sync: [cssAsset],
            },
          },
        },
      ],
    });

  it('serves cached assets within the ttl and refetches after expiry', async () => {
    const pwd = await writeHostManifest();

    let nowMs = 10_000;
    let cssAsset = 'static/css/one.css';
    const fetcher = rs.fn(async () => remoteManifestWithCss(cssAsset));

    const collector = createModuleFederationCssCollector(pwd, {
      fetcher,
      ttlMs: 5_000,
      now: () => nowMs,
    });

    expect(await collector.collect()).toEqual([
      'https://cdn.example.com/a/static/css/one.css',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The remote redeployed, but the cache is still fresh.
    cssAsset = 'static/css/two.css';
    nowMs += 4_999;
    expect(await collector.collect()).toEqual([
      'https://cdn.example.com/a/static/css/one.css',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Past the ttl the collection is refreshed and picks up the redeploy.
    nowMs += 2;
    expect(await collector.collect()).toEqual([
      'https://cdn.example.com/a/static/css/two.css',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not cache errored collections and serves the last good list', async () => {
    const pwd = await writeHostManifest();

    let nowMs = 10_000;
    let failing = false;
    const fetcher = rs.fn(async () => {
      if (failing) {
        return new Response('boom', { status: 500 });
      }
      return remoteManifestWithCss('static/css/one.css');
    });

    const collector = createModuleFederationCssCollector(pwd, {
      fetcher,
      ttlMs: 5_000,
      now: () => nowMs,
      monitors: { warn: rs.fn() } as any,
    });

    expect(await collector.collect()).toEqual([
      'https://cdn.example.com/a/static/css/one.css',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Cache expired and the remote is now failing: serve last-good...
    nowMs += 5_001;
    failing = true;
    expect(await collector.collect()).toEqual([
      'https://cdn.example.com/a/static/css/one.css',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // ...and do NOT cache the failure: the next request retries immediately.
    expect(await collector.collect()).toEqual([
      'https://cdn.example.com/a/static/css/one.css',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);

    failing = false;
    expect(await collector.collect()).toEqual([
      'https://cdn.example.com/a/static/css/one.css',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('coalesces concurrent collections into a single in-flight fetch', async () => {
    const pwd = await writeHostManifest();

    const fetcher = rs.fn(async () =>
      remoteManifestWithCss('static/css/one.css'),
    );
    const collector = createModuleFederationCssCollector(pwd, {
      fetcher,
      ttlMs: 0,
    });

    const [first, second] = await Promise.all([
      collector.collect(),
      collector.collect(),
    ]);

    expect(first).toEqual(['https://cdn.example.com/a/static/css/one.css']);
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // ttlMs 0 keeps the previous per-request freshness for dev.
    await collector.collect();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
