import {
  type ImagePluginOptions,
  imagePlugin,
} from '../../../../packages/runtime/plugin-image/src/cli';

type RsbuildConfig = {
  source?: { define?: Record<string, string> };
};

type ConfigTransformer = (
  config: RsbuildConfig,
  utils: {
    mergeRsbuildConfig: (
      base: RsbuildConfig,
      next: RsbuildConfig,
    ) => RsbuildConfig;
  },
) => Promise<RsbuildConfig> | RsbuildConfig;

type BuilderPlugin = {
  setup: (api: {
    context: { action: string; distPath: string };
    modifyBundlerChain: (handler: unknown) => void;
    modifyRsbuildConfig: (handler: ConfigTransformer) => void;
    onAfterCreateCompiler: (handler: unknown) => void;
  }) => Promise<void> | void;
};

async function resolveIpxAssetPrefix(
  options?: ImagePluginOptions,
): Promise<string | undefined> {
  let configFactory: (() => { builderPlugins: unknown[] }) | undefined;
  const modernPlugin = imagePlugin(options);

  modernPlugin.setup({
    config(factory: () => { builderPlugins: unknown[] }) {
      configFactory = factory;
    },
  } as never);

  const config = configFactory?.();
  expect(config).toBeDefined();
  const builderPlugin = config?.builderPlugins[0] as BuilderPlugin;
  const configTransformers: ConfigTransformer[] = [];

  await builderPlugin.setup({
    context: { action: 'dev', distPath: '/dist' },
    modifyBundlerChain() {},
    modifyRsbuildConfig(handler) {
      configTransformers.push(handler);
    },
    onAfterCreateCompiler() {},
  });

  for (const transform of configTransformers) {
    const transformed = await transform(
      {},
      {
        mergeRsbuildConfig: (_base, next) => next,
      },
    );
    const assetPrefix =
      transformed.source?.define?.__RSBUILD_IMAGE_IPX_ASSET_PREFIX__;
    if (assetPrefix !== undefined) {
      return assetPrefix;
    }
  }

  return undefined;
}

describe('@modern-js/image IPX route', () => {
  test('uses the Modern.js route rather than the Rsbuild fallback', async () => {
    const assetPrefix = await resolveIpxAssetPrefix();

    expect(assetPrefix).toBe(JSON.stringify('/_modern/ipx'));
    expect(assetPrefix).not.toBe(JSON.stringify('/_rsbuild/ipx'));
  });

  test.each([
    '/custom/ipx',
    '',
  ])('preserves an explicit consumer assetPrefix %j', async assetPrefix => {
    expect(await resolveIpxAssetPrefix({ ipx: { assetPrefix } })).toBe(
      JSON.stringify(assetPrefix),
    );
  });
});
