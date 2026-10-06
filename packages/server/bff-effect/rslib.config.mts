import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  ...rslibConfig,
  lib: rslibConfig.lib?.map(config => ({
    ...config,
    // Keep `@modern-js/bff-effect/context` a package self-reference in the
    // output: Module Federation shares the request storage by that request.
    output: {
      ...config.output,
      externals: [
        ...[config.output?.externals ?? []].flat(),
        '@modern-js/bff-effect/context',
      ],
    },
    source: {
      ...config.source,
      define: {
        ...config.source?.define,
        __MODERN_EFFECT_NODE_RUNTIME__: JSON.stringify(
          config.output?.target === 'node',
        ),
      },
    },
  })),
});
