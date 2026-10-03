import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RendererIdentity } from '@modern-js/renderer-core';
import { validateNativeClientAssetManifest } from '@modern-js/renderer-core/server';
import { createRsbuild, type Rspack, rspack } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { nativeClientAssetsPlugin } from '../../src/native-composition/native-assets';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'asset-proof',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'a'.repeat(64),
};

async function compile(options: {
  module?: boolean;
  publicPath?: string;
  identity?: RendererIdentity;
  auxiliaryEntry?: boolean;
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-native-assets-'));
  let compiler: Rspack.MultiCompiler | undefined;
  try {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'asset-proof', type: 'module' }),
    );
    fs.writeFileSync(
      path.join(root, 'client.ts'),
      'import "./style.css"; globalThis.assetProof = true;',
    );
    fs.writeFileSync(
      path.join(root, 'style.css'),
      'body { color: rebeccapurple; }',
    );
    fs.writeFileSync(
      path.join(root, 'server.ts'),
      'export const artifactProof = "native-server";',
    );
    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        mode: 'production',
        plugins: [
          nativeClientAssetsPlugin('solid', () =>
            options.identity ? { main: options.identity } : {},
          ),
          ...(options.auxiliaryEntry
            ? [
                {
                  name: 'owned-native-lazy-entry-proof',
                  setup(api) {
                    api.modifyRspackConfig((config, { environment }) => {
                      if (environment.name !== 'client') return;
                      if (
                        !config.entry ||
                        typeof config.entry !== 'object' ||
                        Array.isArray(config.entry)
                      )
                        throw new Error('Expected named client entries');
                      config.entry['compiler-owned-lazy-module'] = {
                        import: [path.join(root, 'client.ts')],
                      };
                    });
                  },
                } satisfies import('@rsbuild/core').RsbuildPlugin,
              ]
            : []),
        ],
        output: {
          minify: false,
          sourceMap: false,
          filenameHash: false,
          cleanDistPath: false,
        },
        performance: { printFileSize: false },
        environments: {
          client: {
            source: { entry: { main: path.join(root, 'client.ts') } },
            output: {
              target: 'web',
              module: options.module ?? false,
              distPath: { root: path.join(root, 'dist') },
              assetPrefix: options.publicPath ?? '/assets/',
            },
            tools: {
              htmlPlugin: false,
            },
          },
          server: {
            source: { entry: { main: path.join(root, 'server.ts') } },
            output: {
              target: 'node',
              module: options.module ?? false,
              distPath: { root: path.join(root, 'dist', 'bundles') },
              filename: { js: '[name].js' },
            },
            tools: { htmlPlugin: false },
          },
        },
      },
    });
    compiler = rspack.rspack(await rsbuild.initConfigs());
    const stats = await new Promise<Rspack.MultiStats>((resolve, reject) =>
      compiler!.run((error, stats) => {
        if (error) reject(error);
        else if (!stats || stats.hasErrors())
          reject(
            new Error(
              stats?.toString({ all: false, errors: true }) ??
                'No compiler stats',
            ),
          );
        else resolve(stats);
      }),
    );
    return {
      root,
      stats,
      cleanup: async () => {
        await new Promise<void>((resolve, reject) =>
          compiler!.close(error => (error ? reject(error) : resolve())),
        );
        fs.rmSync(root, { force: true, recursive: true });
      },
    };
  } catch (error) {
    if (compiler)
      await new Promise<void>(resolve => compiler!.close(() => resolve()));
    fs.rmSync(root, { force: true, recursive: true });
    throw error;
  }
}

describe('compiler-owned native document assets', () => {
  it.each([
    false,
    true,
  ])('records actual scripts, styles and server format, module=%s', async module => {
    const build = await compile({
      module,
      identity,
      publicPath: 'https://cdn.example.test/static/',
    });
    try {
      const client = build.stats.stats.find(
        stats => stats.compilation.name === 'client',
      )!;
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(build.root, 'dist', 'renderer-assets.json'),
          'utf8',
        ),
      );
      const assets = validateNativeClientAssetManifest(manifest, identity);
      expect(assets.map(asset => asset.href)).toEqual(
        client.compilation.entrypoints
          .get('main')!
          .getFiles()
          .filter(file => /\.(?:css|[cm]?js)$/u.test(file))
          .map(file => `https://cdn.example.test/static/${file}`),
      );
      expect(assets.some(asset => asset.kind === 'stylesheet')).toBe(true);
      expect(
        assets
          .filter(asset => asset.kind === 'script')
          .every(asset => asset.scriptType === (module ? 'module' : 'classic')),
      ).toBe(true);
      const server = build.stats.stats.find(
        stats => stats.compilation.name === 'server',
      )!;
      const file = [
        ...server.compilation.entrypoints.get('main')!.getEntrypointChunk()
          .files,
      ].find(file => /\.[cm]?js$/u.test(file))!;
      const output = server.compilation.outputOptions.path!;
      expect(
        JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'))
          .type,
      ).toBe(module ? 'module' : 'commonjs');
      const exports = await import(pathToFileURL(path.join(output, file)).href);
      expect((exports.default ?? exports).artifactProof).toBe('native-server');
      expect(() =>
        validateNativeClientAssetManifest(manifest, {
          ...identity,
          buildId: 'b'.repeat(64),
        }),
      ).toThrow();
    } finally {
      await build.cleanup();
    }
  }, 30_000);

  it.each([
    'auto',
    './',
  ])('rejects nonauthoritative %s asset URLs before a document manifest can be emitted', async publicPath => {
    await expect(compile({ publicPath, identity })).rejects.toThrow(
      'explicit output.assetPrefix',
    );
  }, 30_000);

  it('rejects a compiled entry without an owning immutable identity', async () => {
    await expect(compile({})).rejects.toThrow('no resolved identity for main');
  }, 30_000);

  it('keeps compiler-owned auxiliary entries separate from application documents', async () => {
    const build = await compile({ identity, auxiliaryEntry: true });
    try {
      const client = build.stats.stats.find(
        stats => stats.compilation.name === 'client',
      )!;
      expect(
        client.compilation.entrypoints.has('compiler-owned-lazy-module'),
      ).toBe(true);
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(build.root, 'dist', 'renderer-assets.json'),
          'utf8',
        ),
      );
      expect(Object.keys(manifest.entries)).toEqual(['main']);
      expect(
        validateNativeClientAssetManifest(manifest, identity).some(
          asset => asset.kind === 'script',
        ),
      ).toBe(true);
    } finally {
      await build.cleanup();
    }
  }, 30_000);
});
