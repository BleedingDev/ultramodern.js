import { bffPlugin } from '@modern-js/plugin-bff';
import { applyBaseConfig } from '../../utils/applyBaseConfig';

export default applyBaseConfig({
  dev: {
    mockDir: './mocks',
  },
  server: {
    ssr: {
      mode: 'stream',
    },
    tsconfigPath: 'tsconfig.server.json',
  },
  bff: {
    prefix: '/bff-api',
    runtimeFramework: 'hono',
  },
  plugins: [bffPlugin()],
  security: {
    sri: {
      enabled: process.env.NODE_ENV === 'production',
      hashFuncNames: ['sha256'],
    },
  },
});
