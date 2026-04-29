import { appTools, defineConfig } from '@modern-js/app-tools';
import { nanoid } from 'nanoid';
import path from 'path';
import packageMeta from './package.json';

const DEVTOOLS_MARK = nanoid();
const INTERNAL_POSTCSS_LOADER_PATH = path.resolve(
  process.cwd(),
  '../../builder/builder-shared/compiled/postcss-loader/index.js',
);

// https://modernjs.dev/en/configure/app/usage
export default defineConfig<'rspack'>({
  source: {
    entries: {
      main: {
        entry: './src/index.tsx',
        disableMount: true,
      },
    },
    preEntry: [
      require.resolve('modern-normalize/modern-normalize.css'),
      require.resolve('@radix-ui/themes/styles.css'),
    ],
    globalVars: {
      'process.env.VERSION': packageMeta.version,
      'process.env.DEVTOOLS_MARK': DEVTOOLS_MARK,
    },
  },
  output: {
    copy: [{ from: './src/types.d.ts', to: './' }],
    legalComments: 'linked',
    disableCssExtract: true,
    disableFilenameHash: true,
    distPath: {
      js: './',
    },
  },
  dev: {
    port: 8781,
  },
  tools: {
    htmlPlugin: process.env.NODE_ENV === 'production' ? false : {},
    minifyCss: {
      minimizerOptions: {
        preset: [
          'default',
          {
            mergeLonghand: false,
            calc: false,
          },
        ],
      },
      warningsFilter: warning =>
        !(
          warning.includes('postcss-calc') &&
          warning.includes('Could not parse expression')
        ),
    },
    styleLoader: {
      insert: function insert(element) {
        const key = `__DEVTOOLS_STYLE_${process.env.DEVTOOLS_MARK}`;
        // @ts-expect-error
        window[key] = window[key] || [];
        // @ts-expect-error
        window[key].push(element);
      },
    },
    bundlerChain(chain) {
      chain.output.libraryTarget('commonjs');
      chain.module
        .rule('RADIX_TOKEN')
        .test(/\/@radix-ui\/themes\/styles.css/)
        .use('RADIX_TOKEN')
        .loader('./plugin/radix-token-transformer.js')
        .options({ root: '._modern_js_devtools_mountpoint' });
    },
  },
  performance: {
    chunkSplit: {
      strategy: 'all-in-one',
    },
    rsdoctor: {
      loaderInterceptorOptions: {
        skipLoaders: [
          'postcss-loader',
          '/packages/builder/builder-shared/compiled/postcss-loader/index.js',
          INTERNAL_POSTCSS_LOADER_PATH,
        ],
      },
    },
  },
  plugins: [
    appTools({
      bundler: 'experimental-rspack',
    }),
  ],
});
