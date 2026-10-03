import { fileURLToPath } from 'node:url';
import { defineConfig } from '@scripts/rstest-config';

function nativeCompiler(server: boolean) {
  return {
    rspack: {
      module: {
        rules: [
          {
            enforce: 'pre' as const,
            test: /\.[cm]?[jt]sx?$/,
            include: [
              fileURLToPath(new URL('./src', import.meta.url)),
              fileURLToPath(new URL('./tests', import.meta.url)),
            ],
            use: [
              {
                loader: fileURLToPath(
                  new URL('./native-loader.cjs', import.meta.url),
                ),
                options: { server },
              },
            ],
          },
        ],
      },
    },
  };
}

// The shared preset adds Node resolution conditions when arrays are merged.
// Native browser primitives must resolve without the Node condition.
export default defineConfig({
  testTimeout: 30_000,
  projects: [
    {
      name: 'client',
      root: __dirname,
      include: ['tests/client/**/*.test.{ts,tsx}'],
      testEnvironment: 'happy-dom',
      setupFiles: ['./tests/client/fetch-platform.ts'],
      globals: true,
      output: { bundleDependencies: true },
      tools: nativeCompiler(false),
      resolve: {
        conditionNames: ['modern:source', 'browser', 'import', 'default'],
      },
    },
    {
      name: 'server',
      root: __dirname,
      include: ['tests/server/**/*.test.ts'],
      testEnvironment: 'node',
      globals: true,
      tools: nativeCompiler(true),
      resolve: {
        conditionNames: ['modern:source', 'node', 'import', 'default'],
      },
    },
  ],
});
