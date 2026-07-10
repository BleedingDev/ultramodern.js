import type { ProjectConfig } from '@rstest/core';
import { withTestPreset } from '@scripts/rstest-config';

const commonConfig: ProjectConfig = {
  setupFiles: ['@scripts/rstest-config/setup.ts'],
  globals: true,
  tools: {
    swc: {
      jsc: {
        transform: {
          react: {
            runtime: 'automatic',
          },
        },
      },
    },
  },
};

export default {
  projects: [
    withTestPreset({
      name: 'plugin-tanstack-node',
      testEnvironment: 'node',
      include: [
        'tests/realm-isolation.test.ts',
        'tests/router/cli.test.ts',
        'tests/router/fastDefaults.test.ts',
        'tests/router/flightSerialization.roundtrip.test.tsx',
        'tests/router/generateRouteArtifacts.test.ts',
        'tests/router/hooks.test.ts',
        'tests/router/loaderBridge.test.ts',
        'tests/router/packageSurface.test.ts',
        'tests/router/preloadRedirect.test.ts',
        'tests/router/register.test.ts',
        'tests/router/routeHooks.test.ts',
        'tests/router/rscPayloadRouterMatrix.test.ts',
        'tests/router/rsc.test.tsx',
        'tests/router/slotUsageSanitizer.test.ts',
        'tests/router/ssrPreload.test.ts',
        'tests/router/tanstackTypes.test.ts',
        'tests/router/routeTree.test.ts',
      ],
      extends: commonConfig,
    }),
    withTestPreset({
      name: 'plugin-tanstack-client',
      testEnvironment: 'happy-dom',
      include: [
        'tests/router/dataMutation.test.tsx',
        'tests/router/hydrationBoundary.test.tsx',
        'tests/router/prefetchLink.test.tsx',
        'tests/router/prefetchLinkPreload.test.tsx',
      ],
      extends: commonConfig,
    }),
  ],
};
