import { copySync, statSync } from 'fs-extra';
import { dirname, join } from 'path';
import type { TaskConfig } from './types';

export const ROOT_DIR = join(__dirname, '..', '..', '..');
export const PACKAGES_DIR = join(ROOT_DIR, 'packages');
export const DIST_DIR = 'compiled';

export const DEFAULT_EXTERNALS = {
  // External caniuse-lite data, so users can update it manually.
  'caniuse-lite': 'caniuse-lite',
  '/^caniuse-lite(/.*)/': 'caniuse-lite$1',
  // External webpack, it's hard to bundle.
  webpack: 'webpack',
  '/^webpack(/.*)/': 'webpack$1',
  // External lodash because lots of packages will depend on it.
  lodash: '@modern-js/utils/lodash',
  '/^lodash(/.*)/': 'lodash$1',
  // ncc bundled wrong package.json, using external to avoid this problem
  './package.json': './package.json',
  '../package.json': './package.json',
  '../../package.json': './package.json',
  postcss: 'postcss',
  '@babel/core': '@babel/core',
  '@babel/types': '@babel/types',
  '@babel/parser': '@babel/parser',
  '@babel/runtime': '@babel/runtime',
  '/^@babel/runtime(/.*)/': '@babel/runtime$1',
};

export const TASKS: TaskConfig[] = [
  {
    packageDir: 'toolkit/utils',
    packageName: '@modern-js/utils',
    dependencies: [
      // zero dependency
      'address',
      'filesize',
      'minimist',
      'commander',
      'import-lazy',
      'dotenv-expand',
      'url-join',
      'slash',
      'nanoid',
      'upath',
      // a few dependencies
      'debug',
      {
        name: 'semver',
        emitDts: false,
        afterBundle(task) {
          copySync(
            dirname(require.resolve('@types/semver/package.json')),
            task.distPath,
            {
              filter: file =>
                statSync(file).isDirectory() || file.endsWith('.d.ts'),
            },
          );
        },
      },
      'js-yaml',
      'mime-types',
      'strip-ansi',
      'gzip-size',
      {
        name: 'json5',
        externals: {
          minimist: '../minimist',
        },
      },
      // some dependencies
      'glob',
      'chalk',
      {
        name: 'signale',
        packageJsonField: ['options'],
      },
      'execa',
      'fs-extra',
      'browserslist',
      'chokidar',
      {
        name: 'globby',
        externals: {
          'fast-glob': 'fast-glob',
        },
      },
      'ora',
      'inquirer',
      {
        name: 'tsconfig-paths',
        emitFiles: [
          {
            path: 'index.mjs',
            content:
              "import paths from './index.js';\nexport const { register, loadConfig, createMatchPath, matchFromAbsolutePaths, createMatchPathAsync, matchFromAbsolutePathsAsync } = paths;\n",
          },
        ],
        externals: {
          json5: '../json5',
          minimist: '../minimist',
        },
      },
    ],
  },
];
