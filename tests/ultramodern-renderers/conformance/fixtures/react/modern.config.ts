import { tanstackRouterPlugin } from '@bleedingdev/modern-js-plugin-tanstack';
import { defineConfig } from '@bleedingdev/modern-js-ultramodern-app-tools';

export default defineConfig({
  renderer: 'react',
  plugins: [tanstackRouterPlugin()],
  server: { ssr: { mode: 'stream' } },
});
