import { bffPlugin } from '@modern-js/plugin-bff';
import { applyBaseConfig } from '../../../utils/applyBaseConfig';

export default applyBaseConfig({
  bff: {
    prefix: '/api-app',
    crossProject: true,
    runtimeFramework: 'effect',
    effect: {
      entry: './api/effect/index',
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
