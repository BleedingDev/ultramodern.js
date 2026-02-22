import { bffPlugin } from '@modern-js/plugin-bff';
import { applyBaseConfig } from './applyBaseConfig';

export default applyBaseConfig({
  bff: {
    prefix: '/api-app',
    crossProject: true,
    runtimeFramework: 'effect',
    effect: {
      openapi: {
        path: '/openapi.json',
      },
    },
  },
  plugins: [bffPlugin()],
  server: {
    port: 3399,
  },
  output: {
    distPath: {
      root: 'dist-1',
    },
  },
});
