import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyOptionsChain, isProd } from '@modern-js/utils';
import {
  logger,
  type PostCSSLoaderOptions,
  type RsbuildPlugin,
} from '@rsbuild/core';
import type { Options } from 'cssnano';
import { getCssSupport } from '../shared/getCssSupport';
import type { ToolsAutoprefixerConfig } from '../types';

const builderRequire = createRequire(import.meta.url);

const createRootRequire = (rootPath: string) =>
  createRequire(pathToFileURL(path.join(rootPath, 'package.json')).href);

const loadByResolver = (resolveWith: NodeRequire, name: string) => {
  try {
    return resolveWith(name);
  } catch (error) {
    const resolved = resolveWith.resolve(name);
    return resolveWith(resolved);
  }
};

const loadPostcssPlugin = (name: string, appRootPath: string) => {
  const resolvers = [
    builderRequire,
    createRootRequire(appRootPath),
    createRootRequire(process.cwd()),
  ];

  let firstError: unknown = null;

  for (const resolveWith of resolvers) {
    try {
      return loadByResolver(resolveWith, name);
    } catch (error) {
      firstError ??= error;
    }
  }

  throw firstError;
};

const importPostcssPlugin = (name: string, appRootPath: string) =>
  Promise.resolve(loadPostcssPlugin(name, appRootPath)) as Promise<any>;

type PostCSSConfig = NonNullable<PostCSSLoaderOptions['postcssOptions']>;
type PostCSSOptions = Exclude<PostCSSConfig, (loader: any) => any>;

const clonePostCSSConfig = (config: PostCSSOptions) => ({
  ...config,
  plugins: config.plugins ? [...config.plugins] : undefined,
});

type PostcssLoadConfig = (
  ctx: Record<string, unknown>,
  rootPath: string,
) => Promise<PostCSSOptions>;

const postcssLoadConfig = builderRequire(
  'postcss-load-config',
) as PostcssLoadConfig;

const userPostcssrcCache = new Map<
  string,
  PostCSSOptions | Promise<PostCSSOptions>
>();

const loadUserPostcssrc = async (root: string): Promise<PostCSSOptions> => {
  const cached = userPostcssrcCache.get(root);

  if (cached) {
    return clonePostCSSConfig(await cached);
  }

  const promise = postcssLoadConfig({}, root).catch(err => {
    if (err?.message?.includes('No PostCSS Config found')) {
      return {} as PostCSSOptions;
    }
    throw err;
  });

  userPostcssrcCache.set(root, promise);

  return promise.then(config => {
    userPostcssrcCache.set(root, config);
    return clonePostCSSConfig(config);
  });
};

export interface PluginPostcssOptions {
  autoprefixer?: ToolsAutoprefixerConfig;
}

// enable autoprefixer and  support compat legacy browsers
export const pluginPostcss = (
  options: PluginPostcssOptions = {},
): RsbuildPlugin => ({
  name: 'builder:postcss-plugins',

  pre: ['builder:environment-defaults-plugin'],

  setup(api) {
    const { autoprefixer } = options;
    api.modifyEnvironmentConfig(async (config, { mergeEnvironmentConfig }) => {
      if (config.output.target !== 'web') {
        return config;
      }

      // only web target provides CSS outputs, so we can ignore other target
      const cssSupport = getCssSupport(config.output.overrideBrowserslist!);
      const enableExtractCSS = !config.output?.injectStyles;

      const enableCssMinify = !enableExtractCSS && isProd();

      const cssnanoOptions: Options = {
        preset: [
          'default',
          {
            // merge longhand will break safe-area-inset-top, so disable it
            // https://github.com/cssnano/cssnano/issues/803
            // https://github.com/cssnano/cssnano/issues/967
            mergeLonghand: false,
            /**
             * normalizeUrl will transform relative url from `./assets/img.svg` to `assets/img.svg`.
             * It may break the behavior of webpack resolver while using style-loader.
             * So disable it while `output.injectStyles = true`
             */
            normalizeUrl: false,
          },
        ],
      };

      const plugins = await Promise.all([
        importPostcssPlugin('postcss-flexbugs-fixes', api.context.rootPath),
        !cssSupport.customProperties &&
          importPostcssPlugin(
            'postcss-custom-properties',
            api.context.rootPath,
          ),
        !cssSupport.initial &&
          importPostcssPlugin('postcss-initial', api.context.rootPath),
        !cssSupport.pageBreak &&
          importPostcssPlugin('postcss-page-break', api.context.rootPath),
        !cssSupport.fontVariant &&
          importPostcssPlugin('postcss-font-variant', api.context.rootPath),
        !cssSupport.mediaMinmax &&
          importPostcssPlugin('postcss-media-minmax', api.context.rootPath),
        importPostcssPlugin('postcss-nesting', api.context.rootPath),
        enableCssMinify &&
          importPostcssPlugin('cssnano', api.context.rootPath).then(cssnano =>
            cssnano(cssnanoOptions),
          ),
        // The last insert autoprefixer
        importPostcssPlugin('autoprefixer', api.context.rootPath).then(
          autoprefixerPlugin =>
            autoprefixerPlugin(
              applyOptionsChain(
                {
                  flexbox: 'no-2009',
                  overrideBrowserslist: config.output.overrideBrowserslist!,
                },
                autoprefixer,
              ),
            ),
        ),
      ]).then(results => results.filter(Boolean));

      const userOptions = await loadUserPostcssrc(api.context.rootPath);

      return mergeEnvironmentConfig(
        {
          tools: {
            postcss: opts => {
              if (typeof opts.postcssOptions === 'function') {
                logger.warn(
                  'unexpected function type postcssOptions, the default postcss plugins will not be applied.',
                );
                return opts;
              }
              const existingOptions = opts.postcssOptions ?? {};
              const mergedOptions = {
                ...userOptions,
                ...existingOptions,
              };
              const userPlugins = userOptions.plugins ?? [];
              const existingPlugins = existingOptions.plugins ?? [];
              mergedOptions.plugins = [
                ...userPlugins,
                ...existingPlugins,
                ...plugins,
              ];
              opts.postcssOptions = mergedOptions;
            },
          },
        },
        // user config has higher priority than builtin config
        config,
      );
    });
  },
});
