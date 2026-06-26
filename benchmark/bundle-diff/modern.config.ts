import { appTools, defineConfig } from '@modern-js/app-tools';
import type { RspackChain } from '@rsbuild/core';
import { RsdoctorRspackPlugin } from '@rsdoctor/rspack-plugin';

const isCI = process.env.CI === 'true';

// https://modernjs.dev/en/configure/app/usage
export default defineConfig({
  tools: {
    bundlerChain: (chain: RspackChain) => {
      if (process.env.RSDOCTOR) {
        chain.plugin('rsdoctor').use(
          new RsdoctorRspackPlugin({
            output: isCI
              ? {
                  mode: 'brief',
                  options: {
                    type: ['json'],
                  },
                }
              : {},
            features: isCI ? ['bundle'] : ['bundle', 'loader', 'plugins'],
          }),
        );
      }
    },
  },
  plugins: [appTools()],
});
