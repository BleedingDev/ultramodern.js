import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Renderer } from '@modern-js/renderer-core';
import type { RsbuildPlugin, RsbuildPluginAPI } from '@rsbuild/core';

export type SvgDefaultExport = 'component' | 'url';

/** `import Icon from './icon.svg?component'` selects a renderer component. */
export const SVG_COMPONENT_QUERY = /^\?component$/u;
const SCRIPT_ISSUER = /\.(?:[cm]?[jt]sx?|tsrx)$/u;

/** Generated components live with the native entry sources the compiler owns. */
export function svgComponentOutputDirectory(
  rootPath: string,
  renderer: Renderer,
): string {
  return path.join(
    rootPath,
    'node_modules',
    '.modern-js',
    renderer,
    'svg-components',
  );
}

/** The CommonJS loader ships in this package's `src` tree in every format. */
function svgComponentLoaderFile(): string {
  for (
    let directory =
      typeof __dirname === 'string'
        ? __dirname
        : path.dirname(fileURLToPath(import.meta.url));
    ;
    directory = path.dirname(directory)
  ) {
    const loader = path.join(
      directory,
      'src/native-composition/svg-component-loader.cjs',
    );
    if (
      fs.existsSync(path.join(directory, 'package.json')) &&
      fs.existsSync(loader)
    )
      return loader;
    if (path.dirname(directory) === directory)
      throw new Error('Cannot locate the UltraModern SVG component loader');
  }
}

/**
 * Route SVG component imports to the renderer's template inside Rsbuild's SVG
 * rule. URL, inline, raw and text queries keep their asset behavior, and
 * stylesheet references stay URLs even when components are the default export.
 */
export function applyNativeSvgComponents(
  api: RsbuildPluginAPI,
  options: {
    renderer: Renderer;
    /** CommonJS module exporting the renderer's component source template. */
    template: string;
    defaultExport?: SvgDefaultExport;
  },
): void {
  const loader = svgComponentLoaderFile();
  api.modifyBundlerChain({
    order: 'post',
    handler(chain, { CHAIN_ID }) {
      const loaderOptions = {
        outputDirectory: svgComponentOutputDirectory(
          api.context.rootPath,
          options.renderer,
        ),
        template: options.template,
      };
      const rule = chain.module.rule(CHAIN_ID.RULE.SVG);
      rule
        .oneOf('native-svg-component')
        .before('svg-asset-url')
        .type('javascript/auto')
        .resourceQuery(SVG_COMPONENT_QUERY)
        .use('native-svg-component')
        .loader(loader)
        .options(loaderOptions);
      if (options.defaultExport === 'component')
        rule
          .oneOf('native-svg-default-component')
          .before('svg-asset')
          .type('javascript/auto')
          .issuer(SCRIPT_ISSUER)
          .use('native-svg-component')
          .loader(loader)
          .options(loaderOptions);
    },
  });
}

export function nativeSvgComponentsPlugin(options: {
  renderer: Renderer;
  template: string;
  defaultExport?: SvgDefaultExport;
}): RsbuildPlugin {
  return {
    name: `ultramodern:${options.renderer}:svg-components`,
    setup: api => applyNativeSvgComponents(api, options),
  };
}
