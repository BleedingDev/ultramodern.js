// @effect-diagnostics processEnv:off
import { bffPlugin } from '@modern-js/plugin-bff';
import { applyBaseConfig } from './applyBaseConfig';

const runtimeFramework =
  process.env.BFF_RUNTIME === 'effect' ? 'effect' : 'hono';

export default applyBaseConfig({
  bff: {
    prefix: '/bff-api',
    runtimeFramework,
    enableHandleWeb: true,
  },
  plugins: [bffPlugin()],
});
