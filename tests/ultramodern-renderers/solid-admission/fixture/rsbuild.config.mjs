import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rsbuild/core';

const resolve = createRequire(import.meta.url);
const preserveImports = path.join(
  path.dirname(resolve.resolve('@modern-js/renderer-solid/package.json')),
  'src/plugin/preserve-import-loader.cjs',
);
const loader = fileURLToPath(new URL('./solid-loader.cjs', import.meta.url));
const solidPlugin = {
  name: 'ultramodern-solid-admission-compiler',
  setup(api) {
    api.modifyRspackConfig((config, { environment, isProd }) => {
      const server = environment.config.output.target === 'node';
      config.resolve.conditionNames = [
        'solid',
        ...(server ? ['node'] : ['browser']),
        ...(!isProd ? ['development'] : []),
        'import',
        'default',
      ];
      if (!server) {
        config.module.rules.unshift({
          test: /[/]@solidjs[/]web[/]dist[/]web(?:\.dev)?\.js$/,
          enforce: 'pre',
          use: [preserveImports],
        });
        config.experiments = { ...config.experiments, outputModule: true };
        config.output = {
          ...config.output,
          module: true,
          chunkFormat: 'module',
          chunkLoading: 'import',
          iife: false,
          scriptType: 'module',
          library: { type: 'module' },
        };
        config.optimization.runtimeChunk = { name: 'runtime' };
      }
      config.module.rules.unshift({
        test: /\.[jt]sx$/,
        enforce: 'pre',
        use: [{ loader, options: { server, refresh: !server && !isProd } }],
      });
      return config;
    });
  },
};
export default defineConfig({
  plugins: [solidPlugin],
  server: { port: 4193, strictPort: true },
  source: { entry: { index: './src/client.tsx', lazy: './src/Lazy.tsx' } },
  html: {
    scriptLoading: 'module',
    templateContent:
      '<!doctype html><html><body><div id="root"></div></body></html>',
  },
  environments: {
    client: { output: { target: 'web', distPath: { root: 'dist/client' } } },
    server: {
      source: { entry: { index: './src/server.tsx' } },
      output: {
        target: 'node',
        distPath: { root: 'dist/server' },
        module: true,
      },
      tools: { rspack: { externals: [] } },
    },
  },
});
