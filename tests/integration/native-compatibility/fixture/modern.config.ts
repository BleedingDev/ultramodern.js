import { appTools, defineConfig } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';

export default defineConfig({
  plugins: [appTools(), bffPlugin()],
  server: {
    ssr: {
      mode: process.env.NATIVE_SSR_MODE === 'stream' ? 'stream' : 'string',
    },
  },
  output: { polyfill: 'off', disableTsChecker: true },
  performance: { buildCache: false },
});
