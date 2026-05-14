import { bffPlugin } from '@modern-js/plugin-bff';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { applyBaseConfig } from '../../utils/applyBaseConfig';

export default applyBaseConfig({
  bff: {
    prefix: '/bff-api',
    runtimeFramework: 'effect',
    effect: {
      openapi: {
        path: '/openapi.json',
      },
    },
  },
  html: {
    scriptLoading: 'defer',
    template: './src/html/index.html',
  },
  output: {
    filenameHash: false,
  },
  plugins: [bffPlugin(), tanstackRouterPlugin()],
  server: {
    ssr: {
      mode: 'string',
    },
  },
});
