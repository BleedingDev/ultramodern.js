import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  collectDirectRemoteModuleFederationCss,
  collectModuleFederationManifestCss,
} from '../../src/adapters/node/plugins/moduleFederationCss';

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

  it('loads direct remote manifests from the host manifest without throwing on failures', async () => {
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

    const css = await collectDirectRemoteModuleFederationCss(pwd, {
      fetcher,
      monitors: {
        warn,
      } as any,
    });

    expect(css).toEqual([
      'https://cdn.example.com/a/static/css/shared.css',
      'https://cdn.example.com/a/static/css/expose.css',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
