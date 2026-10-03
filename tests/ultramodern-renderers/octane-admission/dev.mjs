import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { createRsbuild } = await import(
  pathToFileURL(require.resolve('@rsbuild/core'))
);
const { OctaneRspackPlugin } = await import(
  pathToFileURL(require.resolve('@octanejs/rspack-plugin'))
);
const rsbuild = await createRsbuild({
  cwd: root,
  rsbuildConfig: {
    source: { entry: { index: './src/client.ts' } },
    html: { mountId: 'app' },
    server: { host: '127.0.0.1', port: 40729 },
    output: { distPath: { root: 'dist/dev' } },
    plugins: [
      {
        name: 'ultramodern:octane:admission-host',
        setup(api) {
          api.modifyRspackConfig(config => {
            config.plugins.push(
              new OctaneRspackPlugin({
                root,
                environment: 'client',
                transpile: false,
                parallel: false,
              }),
            );
            config.module.rules.push({
              test: /\.tsrx$/,
              type: 'javascript/auto',
              use: [
                {
                  loader: 'builtin:swc-loader',
                  options: { detectSyntax: 'auto' },
                },
              ],
            });
          });
        },
      },
    ],
  },
});
const server = await rsbuild.startDevServer();
console.log(JSON.stringify({ hmrAdmissionUrls: server.urls }));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await server.server.close();
    process.exit();
  });
}
