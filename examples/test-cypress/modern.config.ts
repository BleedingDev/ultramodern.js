import { defineConfig } from '@modern-js/app-tools';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { ultramodernAppTools } from '@modern-js/ultramodern-app-tools';

// https://modernjs.dev/en/configure/app/usage
export default defineConfig({
  plugins: [ultramodernAppTools(), tanstackRouterPlugin()],
});
