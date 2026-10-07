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
  lazyStyles?: 'renderer' | 'document';
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
      'import "./style.css"; globalThis.assetProof = true; void import("./application.client");',
    );
    fs.writeFileSync(
      path.join(root, 'style.css'),
      'body { color: rebeccapurple; }',
    );
    // The generated entry loads routes and layouts through this import().
    fs.writeFileSync(
      path.join(root, 'application.client.ts'),
      'import "./layout.css"; export const later = () => import("./later");',
    );
    fs.writeFileSync(
      path.join(root, 'layout.css'),
      'main { color: rgb(20, 40, 60); }',
    );
    fs.writeFileSync(
      path.join(root, 'later.ts'),
      'import "./later.css"; export default "later";',
    );
    fs.writeFileSync(path.join(root, 'later.css'), 'aside { color: teal; }');
    fs.writeFileSync(
      path.join(root, 'server.ts'),
      'export const artifactProof = "native-server";',
    );
    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        mode: 'production',
        plugins: [
          nativeClientAssetsPlugin(
            'solid',
            () => (options.identity ? { main: options.identity } : {}),
            options.lazyStyles ?? 'renderer',
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
  it('keeps genuine HMR deltas out of fresh document scripts while preserving runtime order', async () => {
    const root = fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'um-native-hmr-assets-',
      ),
    );
    let close: (() => Promise<void>) | undefined;
    interface CompilationReceipt {
      readonly hash: string | undefined;
      readonly hasErrors: boolean;
      readonly files: readonly {
        readonly name: string;
        readonly hotModuleReplacement: boolean;
      }[];
      readonly runtime: string | undefined;
      readonly manifest: unknown;
    }
    const completed: CompilationReceipt[] = [];
    const waiting: ((receipt: CompilationReceipt) => void)[] = [];
    const nextCompilation = () =>
      completed.length
        ? Promise.resolve(completed.shift()!)
        : new Promise<CompilationReceipt>((resolve, reject) => {
            const deliver = (receipt: CompilationReceipt) => {
              clearTimeout(timeout);
              resolve(receipt);
            };
            const timeout = setTimeout(() => {
              const index = waiting.indexOf(deliver);
              if (index !== -1) waiting.splice(index, 1);
              reject(
                new Error('Actual native HMR compilation did not complete'),
              );
            }, 30_000);
            waiting.push(deliver);
          });
    try {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'asset-proof', private: true }),
      );
      const state = path.join(root, 'state.js');
      fs.writeFileSync(state, 'export const marker = "first";\n');
      fs.writeFileSync(
        path.join(root, 'client.js'),
        'import { marker } from "./state.js"; globalThis.assetProof = marker;\n',
      );
      const rsbuild = await createRsbuild({
        cwd: root,
        rsbuildConfig: {
          mode: 'development',
          plugins: [
            nativeClientAssetsPlugin(
              'solid',
              () => ({ main: identity }),
              'renderer',
            ),
            {
              name: 'observe-genuine-native-hmr-assets',
              setup(api) {
                api.onDevCompileDone(({ stats }) => {
                  const client = (
                    'stats' in stats ? stats.stats : [stats]
                  ).find(candidate => candidate.compilation.name === 'client');
                  if (!client)
                    throw new Error('Actual client compiler is missing');
                  const compilation = client.compilation;
                  const entrypoint = compilation.entrypoints.get('main')!;
                  const receipt: CompilationReceipt = {
                    hash: compilation.hash,
                    hasErrors: client.hasErrors(),
                    files: entrypoint.getFiles().map(name => ({
                      name,
                      hotModuleReplacement:
                        compilation.getAsset(name)!.info
                          .hotModuleReplacement === true,
                    })),
                    runtime: [...entrypoint.getRuntimeChunk()!.files].find(
                      file =>
                        /\.[cm]?js$/u.test(file) &&
                        !compilation.getAsset(file)!.info.hotModuleReplacement,
                    ),
                    manifest: JSON.parse(
                      compilation
                        .getAsset('renderer-assets.json')!
                        .source.source()
                        .toString(),
                    ),
                  };
                  const deliver = waiting.shift();
                  if (deliver) deliver(receipt);
                  else completed.push(receipt);
                });
              },
            },
          ],
          server: { host: '127.0.0.1', port: 0, printUrls: false },
          dev: {
            assetPrefix: '/assets/',
            hmr: true,
            liveReload: false,
            writeToDisk: false,
          },
          output: { minify: false, sourceMap: false },
          performance: { printFileSize: false },
          environments: {
            client: {
              source: { entry: { main: path.join(root, 'client.js') } },
              output: { target: 'web' },
              tools: {
                htmlPlugin: false,
                rspack: {
                  optimization: { runtimeChunk: { name: 'builder-runtime' } },
                },
              },
            },
          },
        },
      });
      const dev = await rsbuild.createDevServer({ getPortSilently: true });
      close = () => dev.close();
      await dev.listen();
      const first = await nextCompilation();
      expect(first.hasErrors).toBe(false);
      expect(first.hash).toBeDefined();
      fs.writeFileSync(state, 'export const marker = "second";\n');
      let second = await nextCompilation();
      while (second.hash === first.hash) second = await nextCompilation();
      expect(second.hasErrors).toBe(false);
      const files = second.files;
      const updates = files
        .filter(file => file.hotModuleReplacement)
        .map(file => file.name);
      expect(updates.some(file => /\.[cm]?js$/u.test(file))).toBe(true);
      const assets = validateNativeClientAssetManifest(
        second.manifest,
        identity,
      );
      expect(assets.map(asset => asset.href)).toEqual(
        files
          .filter(file => !file.hotModuleReplacement)
          .map(file => file.name)
          .filter(file => /\.(?:css|[cm]?js)$/u.test(file))
          .map(file => `/assets/${file}`),
      );
      expect(second.runtime).toBeDefined();
      expect(assets.find(asset => asset.kind === 'script')?.href).toBe(
        `/assets/${second.runtime}`,
      );
      for (const update of updates)
        expect(assets.some(asset => asset.href === `/assets/${update}`)).toBe(
          false,
        );
    } finally {
      await close?.();
      fs.rmSync(root, { force: true, recursive: true });
    }
  }, 30_000);

  it.each([false, true])(
    'records actual scripts, styles and server format, module=%s',
    async module => {
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
        const prefix = 'https://cdn.example.test/static/';
        const hrefs = (kind: string) =>
          assets.filter(asset => asset.kind === kind).map(asset => asset.href);
        expect(hrefs('script')).toEqual(
          client.compilation.entrypoints
            .get('main')!
            .getFiles()
            .filter(file => /\.[cm]?js$/u.test(file))
            .map(file => `${prefix}${file}`),
        );
        // Entry and application styles are linked, ahead of every module;
        // a lazy module's style loads with that module.
        const css = hrefs('stylesheet').map(href =>
          fs.readFileSync(
            path.join(build.root, 'dist', href.slice(prefix.length)),
            'utf8',
          ),
        );
        expect(css).toEqual([
          expect.stringContaining('body'),
          expect.stringContaining('main'),
        ]);
        expect(assets.findIndex(asset => asset.kind !== 'stylesheet')).toBe(
          css.length,
        );
        // Module scripts preload the application; classic scripts cannot.
        const preloads = hrefs('modulepreload');
        expect(preloads.length > 0).toBe(module);
        for (const href of preloads)
          expect(
            fs.readFileSync(
              path.join(build.root, 'dist', href.slice(prefix.length)),
              'utf8',
            ),
          ).not.toContain('"later"');
        expect(
          assets
            .filter(asset => asset.kind === 'script')
            .every(
              asset => asset.scriptType === (module ? 'module' : 'classic'),
            ),
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
        const exports = await import(
          pathToFileURL(path.join(output, file)).href
        );
        expect((exports.default ?? exports).artifactProof).toBe(
          'native-server',
        );
        expect(() =>
          validateNativeClientAssetManifest(manifest, {
            ...identity,
            buildId: 'b'.repeat(64),
          }),
        ).toThrow();
      } finally {
        await build.cleanup();
      }
    },
    30_000,
  );

  it('links every lazy stylesheet when the server render cannot', async () => {
    const build = await compile({ identity, lazyStyles: 'document' });
    try {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(build.root, 'dist', 'renderer-assets.json'),
          'utf8',
        ),
      );
      const assets = validateNativeClientAssetManifest(manifest, identity);
      const css = assets
        .filter(asset => asset.kind === 'stylesheet')
        .map(asset =>
          fs.readFileSync(
            path.join(build.root, 'dist', asset.href.slice('/assets/'.length)),
            'utf8',
          ),
        );
      expect(css).toEqual([
        expect.stringContaining('body'),
        expect.stringContaining('main'),
        expect.stringContaining('aside'),
      ]);
      expect(assets.findIndex(asset => asset.kind !== 'stylesheet')).toBe(3);
      // Only the lazy module's style: its script still loads on demand.
      expect(
        assets.some(
          asset =>
            asset.kind !== 'stylesheet' &&
            fs
              .readFileSync(
                path.join(
                  build.root,
                  'dist',
                  asset.href.slice('/assets/'.length),
                ),
                'utf8',
              )
              .includes('"later"'),
        ),
      ).toBe(false);
    } finally {
      await build.cleanup();
    }
  }, 30_000);

  it.each(['auto', './'])(
    'rejects nonauthoritative %s asset URLs before a document manifest can be emitted',
    async publicPath => {
      await expect(compile({ publicPath, identity })).rejects.toThrow(
        'explicit output.assetPrefix',
      );
    },
    30_000,
  );

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
