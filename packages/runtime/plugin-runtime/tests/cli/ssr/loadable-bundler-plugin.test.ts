import LoadablePlugin from '../../../src/cli/ssr/loadable-bundler-plugin';

const createCompiler = (chunkLoadingGlobal?: string) => {
  const definitions: Array<Record<string, string>> = [];
  const definePluginApply = rstest.fn();

  class DefinePlugin {
    constructor(value: Record<string, string>) {
      definitions.push(value);
    }

    apply = definePluginApply;
  }

  return {
    compiler: {
      options: {
        output: {
          chunkLoadingGlobal,
        },
      },
      webpack: {
        DefinePlugin,
      },
    },
    definitions,
    definePluginApply,
  };
};

describe('LoadableBundlerPlugin chunk loading global', () => {
  test.each([
    {
      name: 'preserves a configured compiler output value',
      configured: '__REMOTE_INVENTORY_CHUNKS__',
      expected: '__REMOTE_INVENTORY_CHUNKS__',
    },
    {
      name: 'uses the legacy fallback when no value is configured',
      configured: undefined,
      expected: '__LOADABLE_LOADED_CHUNKS__',
    },
  ])('$name', ({ configured, expected }) => {
    const { compiler, definitions, definePluginApply } =
      createCompiler(configured);
    const plugin = new LoadablePlugin({
      filename: 'loadable-stats.json',
      outputAsset: false,
    });

    plugin.apply(compiler as never);

    expect(compiler.options.output.chunkLoadingGlobal).toBe(expected);
    expect(definitions).toEqual([
      {
        'process.env.MODERN_CHUNK_LOADING_GLOBAL': JSON.stringify(expected),
      },
    ]);
    expect(definePluginApply).toHaveBeenCalledWith(compiler);
  });

  test('an explicit plugin option wins over configured compiler output', () => {
    const { compiler, definitions } = createCompiler(
      '__REMOTE_INVENTORY_CHUNKS__',
    );
    const plugin = new LoadablePlugin({
      filename: 'loadable-stats.json',
      outputAsset: false,
      chunkLoadingGlobal: '__EXPLICIT_CHUNKS__',
    });

    plugin.apply(compiler as never);

    expect(compiler.options.output.chunkLoadingGlobal).toBe(
      '__EXPLICIT_CHUNKS__',
    );
    expect(definitions).toEqual([
      {
        'process.env.MODERN_CHUNK_LOADING_GLOBAL': JSON.stringify(
          '__EXPLICIT_CHUNKS__',
        ),
      },
    ]);
  });
});
