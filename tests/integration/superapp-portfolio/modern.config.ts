// @effect-diagnostics processEnv:off strictBooleanExpressions:off
import { bffPlugin } from '@modern-js/plugin-bff';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { applyBaseConfig } from '../../utils/applyBaseConfig';

const browserMatrixAssetPrefix = process.env.SUPERAPP_PORTFOLIO_ASSET_PREFIX;
const browserMatrixDistRoot = process.env.SUPERAPP_PORTFOLIO_DIST_ROOT;
const browserMatrixForceCsr = process.env.SUPERAPP_PORTFOLIO_FORCE_CSR === '1';

export default applyBaseConfig({
  bff: {
    prefix: '/bff-api',
    runtimeFramework: 'effect',
    effect: {
      entry: './api/effect/index',
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
    ...(browserMatrixAssetPrefix
      ? { assetPrefix: browserMatrixAssetPrefix }
      : {}),
    ...(browserMatrixDistRoot
      ? {
          distPath: {
            root: browserMatrixDistRoot,
          },
        }
      : {}),
    filenameHash: false,
  },
  plugins: [bffPlugin(), tanstackRouterPlugin()],
  server: {
    ssr: {
      ...(browserMatrixForceCsr ? { forceCSR: true } : {}),
      mode: 'string',
    },
  },
});
