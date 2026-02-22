import { bffPlugin } from '@modern-js/plugin-bff';
import { applyBaseConfig } from './applyBaseConfig';

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
  plugins: [bffPlugin()],
});
