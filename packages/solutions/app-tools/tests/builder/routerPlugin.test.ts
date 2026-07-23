import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROUTE_MANIFEST_FILE } from '@modern-js/utils';
import { rspack } from '@rsbuild/core';
import { RouterPlugin } from '../../src/builder/shared/bundlerPlugins/RouterPlugin';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

const compile = async (context: string, outputPath: string) =>
  new Promise<void>((resolve, reject) => {
    rspack.rspack(
      {
        context,
        entry: { main: './entry.js' },
        experiments: { css: true },
        mode: 'production',
        module: {
          rules: [{ test: /\.css$/u, type: 'css' }],
        },
        optimization: { minimize: false },
        output: {
          chunkFilename: 'static/js/[name].js',
          cssChunkFilename: 'static/css/[name].css',
          cssFilename: 'static/css/[name].css',
          filename: 'static/js/[name].js',
          path: outputPath,
          publicPath: 'auto/',
        },
        plugins: [
          new rspack.HtmlRspackPlugin({ chunks: ['main'] }),
          new RouterPlugin({
            HtmlBundlerPlugin: rspack.HtmlRspackPlugin,
            disableFilenameHash: true,
            enableInlineRouteManifests: false,
          }),
        ],
      },
      (error, stats) => {
        if (error) {
          reject(error);
        } else if (!stats || stats.hasErrors()) {
          reject(
            new Error(
              stats?.toString({ all: false, errors: true }) ??
                'Rspack returned no build stats.',
            ),
          );
        } else {
          resolve();
        }
      },
    );
  });

describe('RouterPlugin', () => {
  it('normalizes the serialized automatic public path in emitted route assets', async () => {
    const context = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-router-plugin-auto-public-path-'),
    );
    tempDirectories.push(context);
    const outputPath = path.join(context, 'dist');

    await Promise.all([
      fs.writeFile(
        path.join(context, 'entry.js'),
        "import './main.css'; import(/* webpackChunkName: 'lazy' */ './lazy.js');\n",
      ),
      fs.writeFile(
        path.join(context, 'lazy.js'),
        "import './lazy.css'; export default 'lazy';\n",
      ),
      fs.writeFile(path.join(context, 'main.css'), '.main { color: red; }\n'),
      fs.writeFile(path.join(context, 'lazy.css'), '.lazy { color: blue; }\n'),
    ]);

    await compile(context, outputPath);

    const routeManifest = JSON.parse(
      await fs.readFile(path.join(outputPath, ROUTE_MANIFEST_FILE), 'utf8'),
    ) as {
      routeAssets: Record<
        string,
        { assets?: string[]; referenceCssAssets?: string[] }
      >;
    };
    const emittedAssets = Object.values(routeManifest.routeAssets).flatMap(
      route => [...(route.assets ?? []), ...(route.referenceCssAssets ?? [])],
    );
    const html = await fs.readFile(path.join(outputPath, 'index.html'), 'utf8');

    expect(emittedAssets).toContain('/static/css/main.css');
    expect(emittedAssets).toContain('/static/css/lazy.css');
    expect(emittedAssets.some(asset => asset.includes('auto/'))).toBe(false);
    expect(html).toContain('src="/static/js/route-manifest-main.js"');
    expect(html).not.toContain('auto/');
  });
});
