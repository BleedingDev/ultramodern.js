import path from 'node:path';
import type { RsbuildPluginAPI } from '@rsbuild/core';

export type SvgDefaultExport = 'component' | 'url';

/** `import Icon from './icon.svg?component'` selects a renderer component. */
export const SVG_COMPONENT_QUERY = /^\?component$/u;
const SCRIPT_ISSUER = /\.(?:[cm]?[jt]sx?|tsrx)$/u;

/** Generated components live with the native entry sources the compiler owns. */
export function svgComponentOutputDirectory(
  rootPath: string,
  renderer: 'solid' | 'octane',
): string {
  return path.join(
    rootPath,
    'node_modules',
    '.modern-js',
    renderer,
    'svg-components',
  );
}

/**
 * Route SVG component imports to the renderer's loader inside Rsbuild's SVG
 * rule. URL, inline, raw and text queries keep their asset behavior, and
 * stylesheet references stay URLs even when components are the default export.
 */
export function applyNativeSvgComponents(
  api: RsbuildPluginAPI,
  options: {
    renderer: 'solid' | 'octane';
    loader: string;
    defaultExport?: SvgDefaultExport;
  },
): void {
  api.modifyBundlerChain({
    order: 'post',
    handler(chain, { CHAIN_ID }) {
      const loaderOptions = {
        outputDirectory: svgComponentOutputDirectory(
          api.context.rootPath,
          options.renderer,
        ),
      };
      const rule = chain.module.rule(CHAIN_ID.RULE.SVG);
      rule
        .oneOf('native-svg-component')
        .before('svg-asset-url')
        .type('javascript/auto')
        .resourceQuery(SVG_COMPONENT_QUERY)
        .use('native-svg-component')
        .loader(options.loader)
        .options(loaderOptions);
      if (options.defaultExport === 'component')
        rule
          .oneOf('native-svg-default-component')
          .before('svg-asset')
          .type('javascript/auto')
          .issuer(SCRIPT_ISSUER)
          .use('native-svg-component')
          .loader(options.loader)
          .options(loaderOptions);
    },
  });
}
