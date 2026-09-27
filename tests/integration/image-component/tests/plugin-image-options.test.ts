import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import {
  type ImagePluginOptions,
  imagePlugin,
} from '../../../../packages/runtime/plugin-image/src/cli';

type Middleware = (
  req: { url?: string },
  res: unknown,
  next: (error?: unknown) => void,
) => void;
type SetupMiddleware = (middlewares: {
  unshift: (...handlers: Middleware[]) => void;
  push: (...handlers: Middleware[]) => void;
}) => void;

type ModernConfig = {
  source?: { define?: Record<string, string> };
  dev?: { setupMiddlewares?: SetupMiddleware[] };
  builderPlugins: unknown[];
};

type RsbuildConfig = {
  source?: { define?: Record<string, string> };
  dev?: { setupMiddlewares?: unknown[] };
};

type ConfigTransformer = (
  config: RsbuildConfig,
  utils: {
    mergeRsbuildConfig: (
      base: RsbuildConfig,
      next: RsbuildConfig,
    ) => RsbuildConfig;
  },
) => Promise<RsbuildConfig | undefined> | RsbuildConfig | undefined;

type BuilderPlugin = {
  setup: (api: {
    context: { action: string; distPath: string };
    modifyBundlerChain: (handler: unknown) => void;
    modifyRsbuildConfig: (handler: ConfigTransformer) => void;
    onAfterCreateCompiler: (handler: unknown) => void;
  }) => Promise<void> | void;
};

function resolveModernConfig(
  options?: ImagePluginOptions,
  compiler?: unknown,
  command = 'dev',
): ModernConfig {
  let configFactory: (() => ModernConfig) | undefined;
  imagePlugin(options).setup({
    getAppContext: () => ({ command }),
    config(factory: () => ModernConfig) {
      configFactory = factory;
    },
    onAfterCreateCompiler(handler: (params: { compiler: unknown }) => void) {
      if (compiler) handler({ compiler });
    },
  } as never);
  const config = configFactory?.();
  expect(config).toBeDefined();
  return config as ModernConfig;
}

async function resolveBuilderDevConfigs(config: ModernConfig, action = 'dev') {
  const builderPlugin = config.builderPlugins[0] as BuilderPlugin;
  const transformers: ConfigTransformer[] = [];
  await builderPlugin.setup({
    context: { action, distPath: '/dist' },
    modifyBundlerChain() {},
    modifyRsbuildConfig(handler) {
      transformers.push(handler);
    },
    onAfterCreateCompiler() {},
  });
  const results: RsbuildConfig[] = [];
  for (const transform of transformers) {
    const next = await transform({}, { mergeRsbuildConfig: (_base, n) => n });
    if (next) results.push(next);
  }
  return results;
}

describe('@modern-js/image IPX route', () => {
  test('the shared ipx loader builds URLs under the Modern.js route', () => {
    expect(
      resolveModernConfig().source?.define?.__RSBUILD_IMAGE_IPX_ASSET_PREFIX__,
    ).toBe(JSON.stringify('/_modern/ipx'));
    expect(
      resolveModernConfig({ ipx: { assetPrefix: '/_images' } }).source?.define
        ?.__RSBUILD_IMAGE_IPX_ASSET_PREFIX__,
    ).toBe(JSON.stringify('/_images'));
  });

  test('the Modern.js dev server mounts IPX, not the Rsbuild image plugin', async () => {
    const config = resolveModernConfig();
    expect(config.dev?.setupMiddlewares).toHaveLength(1);

    // Without an `ipx` option @rsbuild-image/core neither imports ipx nor
    // mounts its own dev middleware.
    const builderConfigs = await resolveBuilderDevConfigs(config);
    expect(
      builderConfigs.some(
        next =>
          next.dev?.setupMiddlewares !== undefined ||
          next.source?.define?.__RSBUILD_IMAGE_IPX_ASSET_PREFIX__ !== undefined,
      ),
    ).toBe(false);
  });

  test('a build without a custom loader still fails instead of emitting dev IPX URLs', async () => {
    await expect(
      resolveBuilderDevConfigs(
        resolveModernConfig(undefined, undefined, 'build'),
        'build',
      ),
    ).rejects.toThrow(/custom `loader`/);
    await expect(
      resolveBuilderDevConfigs(
        resolveModernConfig(
          { loader: './src/image-loader' },
          undefined,
          'build',
        ),
        'build',
      ),
    ).resolves.toBeDefined();
  });

  test('the dev route matches a prefix given with a trailing slash', () => {
    const [setup] =
      resolveModernConfig({ ipx: { assetPrefix: '/_images/' } }).dev
        ?.setupMiddlewares ?? [];
    const handlers: Middleware[] = [];
    setup?.({ unshift: () => {}, push: (...h) => handlers.push(...h) });
    const [ipxRoute] = handlers;

    const passed = { url: '/static/crab.png' };
    let nextCalls = 0;
    ipxRoute(passed, {}, () => nextCalls++);
    expect(nextCalls).toBe(1);

    const routed = { url: '/_images/f_auto,w_500/static/crab.png' };
    ipxRoute(routed, {}, () => nextCalls++);
    expect(nextCalls).toBe(1);
    expect(routed.url).toBe('/f_auto,w_500/static/crab.png');
  });

  test('dev IPX reads images the web compiler kept in memory', async () => {
    const png = fs.readFileSync(path.join(__dirname, '../src/routes/crab.png'));
    const outputPath = path.resolve('/dist');
    const files = new Map([[path.join(outputPath, 'static', 'crab.png'), png]]);
    // The methods read instance state, as a custom outputFileSystem may.
    const memoryFs = {
      files,
      stat(file: string, done: (e: unknown, v?: unknown) => void) {
        this.files.has(file)
          ? done(null, { mtime: new Date(0) })
          : done(new Error(`ENOENT ${file}`));
      },
      readFile(file: string, done: (e: unknown, v?: unknown) => void) {
        this.files.has(file)
          ? done(null, this.files.get(file))
          : done(new Error(`ENOENT ${file}`));
      },
    };
    const compiler = {
      compilers: [
        { name: 'node', outputPath: '/dist/bundles', outputFileSystem: {} },
        { name: 'web', outputPath, outputFileSystem: memoryFs },
      ],
    };
    const [setup] =
      resolveModernConfig(undefined, compiler).dev?.setupMiddlewares ?? [];
    const handlers: Middleware[] = [];
    setup?.({ unshift: () => {}, push: (...h) => handlers.push(...h) });
    const server = http.createServer((req, res) =>
      handlers[0](req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
    );
    await new Promise<void>(resolve => server.listen(0, resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${port}/_modern/ipx/s_20/static/crab.png`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^image\//);

      // A name that merely starts with two dots is still inside the output.
      files.set(path.join(outputPath, 'static', '..crab.png'), png);
      const dotted = await fetch(
        `http://127.0.0.1:${port}/_modern/ipx/s_20/static/..crab.png`,
      );
      expect(dotted.status).toBe(200);

      // IPX decodes the id; a traversal must not leave the output directory.
      files.set(path.resolve(outputPath, '..', 'secret.png'), png);
      // fetch() would collapse the dot segments; send the raw path.
      const escapedStatus = await new Promise<number | undefined>(
        (resolve, reject) =>
          http
            .get({ port, path: '/_modern/ipx/_/%2E%2E%2Fsecret.png' }, res => {
              res.resume();
              resolve(res.statusCode);
            })
            .on('error', reject),
      );
      expect(escapedStatus).not.toBe(200);
    } finally {
      server.close();
    }
  });

  test('ipx resolves from the upstream npm name on the 4.x line', () => {
    const pluginRequire = createRequire(
      path.resolve(
        __dirname,
        '../../../../packages/runtime/plugin-image/package.json',
      ),
    );
    const manifest = pluginRequire('ipx/package.json');
    expect(manifest.name).toBe('ipx');
    expect(manifest.version).toMatch(/^4\./);
  });
});
