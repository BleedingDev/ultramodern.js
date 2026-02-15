import { bffPlugin } from '@modern-js/plugin-bff';
import { applyBaseConfig } from '../../utils/applyBaseConfig';

export default applyBaseConfig({
  bff: {
    prefix: '/bff-api',
    runtimeFramework: 'effect',
  },
  plugins: [bffPlugin()],
});
