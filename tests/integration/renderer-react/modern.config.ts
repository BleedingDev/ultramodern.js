import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { defineConfig } from '@modern-js/ultramodern-app-tools';

export default defineConfig({
  renderer: 'react',
  plugins: [tanstackRouterPlugin()],
  server: { ssr: { mode: 'stream' } },
});
