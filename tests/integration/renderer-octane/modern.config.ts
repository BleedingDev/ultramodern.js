import { defineConfig } from '@modern-js/ultramodern-app-tools';

// The csr specs build the same app without SSR.
export default defineConfig({
  renderer: 'octane',
  server: { ssr: process.env.RENDERER_CSR !== 'true' },
});
