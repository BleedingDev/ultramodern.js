import { rslibConfig } from '@modern-js/rslib';
import { defineConfig, type RslibConfig, type Rspack } from '@rslib/core';
import { publicDeclarationsPlugin } from '../../../scripts/prebundle/ultramodern/public-declarations.mjs';

const dependencies = [
  'address',
  'filesize',
  'minimist',
  'commander',
  'import-lazy',
  'dotenv-expand',
  'url-join',
  'slash',
  'nanoid',
  'lodash',
  'upath',
  'debug',
  'semver',
  'js-yaml',
  'mime-types',
  'strip-ansi',
  'gzip-size',
  'json5',
  'glob',
  'chalk',
  'webpack-chain',
  'signale',
  'execa',
  'fs-extra',
  'browserslist',
  'chokidar',
  'globby',
  'ora',
  'inquirer',
  'tsconfig-paths',
];

const externalsMap = dependencies.map(name => ({
  name,
  regex: new RegExp(`compiled[\\/]${name}(?:[\\/]|$)`),
}));

// externalize pre-bundled dependencies
const createExternals =
  (type?: string, noESM = false): Rspack.ExternalItem =>
  ({ request }, callback) => {
    if (request) {
      for (const { name, regex } of externalsMap) {
        if (request === name) {
          throw new Error(
            `"${name}" is not allowed to be imported, use "../compiled/${name}/index.js" instead.`,
          );
        }
        if (regex.test(request)) {
          const index =
            !noESM && request.endsWith('.mjs') ? 'index.mjs' : 'index.js';
          const base = request.replace(/[/\\]index\.[cm]?js$/, '');
          const external = `${base}/${index}`;
          return callback(undefined, type ? `${type} ${external}` : external);
        }
      }
    }
    callback();
  };

const lib: RslibConfig['lib'] = rslibConfig.lib?.map(config => {
  if (config.format === 'esm') {
    return {
      ...config,
      output: {
        ...config.output,
        externals: [createExternals()],
      },
    };
  }
  if (config.format === 'cjs') {
    return {
      ...config,
      output: {
        ...config.output,
        externals: [
          createExternals('commonjs', true),
          {
            'import-meta-resolve': 'var {}',
          },
        ],
        copy: [
          {
            from: './compiled',
            to: '../compiled',
          },
        ],
      },
    };
  }
  return config;
});

export default defineConfig({
  ...rslibConfig,
  plugins: [...(rslibConfig.plugins ?? []), publicDeclarationsPlugin('utils')],
  lib,
});
