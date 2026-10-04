import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import {
  configureUltramodernTypeChecker,
  resolveNativeTypeCheckerCommand,
} from '@modern-js/app-tools-extensions/native-type-checker';
import type { Renderer } from '@modern-js/renderer-core';
import { resolveCandidateRendererProfile } from './renderer-profile';

export const rendererTypeCheckerOptions = (renderer: Renderer) => ({
  typescript: {
    configOverwrite: {
      compilerOptions: {
        jsxImportSource:
          resolveCandidateRendererProfile(renderer).jsxImportSource,
      },
    },
  },
});

/** The selected SDK composition owns checker defaults, before user options. */
export const rendererTypeCheckerPlugin = (
  renderer: Renderer,
): CliPlugin<AppTools> => ({
  name: '@modern-js/ultramodern-type-checker',
  pre: ['@modern-js/plugin-initialize'],
  setup(api) {
    api.config(() => ({
      tools: {
        tsChecker: rendererTypeCheckerOptions(renderer),
        bundlerChain(chain, utils) {
          const pluginId = utils.CHAIN_ID.PLUGIN.TS_CHECKER;
          if (!chain.plugins.has(pluginId)) return;
          const options = chain.plugin(pluginId).get('args')?.[0];
          if (options?.typescript?.tsgo === false) {
            throw new Error(
              'unsupported-type-checker: UltraModern requires native TypeScript 7.0.2; typescript.tsgo cannot be false',
            );
          }
          const typescriptPath = options?.typescript?.typescriptPath;
          if (typeof typescriptPath !== 'string' || !typescriptPath) {
            throw new Error(
              'unsupported-type-checker: UltraModern requires the selected native TypeScript 7.0.2 package',
            );
          }
          configureUltramodernTypeChecker(chain, pluginId, () =>
            resolveNativeTypeCheckerCommand(typescriptPath),
          );
        },
      },
    }));
  },
});
