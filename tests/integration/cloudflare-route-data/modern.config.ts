import { defineConfig } from '@modern-js/app-tools';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { ultramodernAppTools } from '@modern-js/ultramodern-app-tools';

export default defineConfig({
  server: {
    ssr: {
      mode: 'stream',
    },
  },
  deploy: {
    worker: {
      compatibilityDate: '2026-06-02',
      name: 'modernjs-cloudflare-route-data',
      ssr: true,
    },
  },
  output: {
    polyfill: 'off',
    disableTsChecker: true,
    minify: true,
  },
  performance: {
    buildCache: false,
  },
  plugins: [ultramodernAppTools(), tanstackRouterPlugin()],
});
