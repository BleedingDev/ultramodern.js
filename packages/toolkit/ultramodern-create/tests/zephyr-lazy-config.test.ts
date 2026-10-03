import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { shellApp } from '../src/ultramodern-workspace/descriptors';
import { createAppModernConfig } from '../src/ultramodern-workspace/module-federation';

type BuildConfig = { plugins?: Array<unknown> };
type RspackHandler = (config: BuildConfig) => Promise<BuildConfig>;
type ZephyrPlugin = {
  setup(api: { modifyRspackConfig(handler: RspackHandler): void }): void;
};

const { getBuildConfigEnvironment, withBuildConfigEnvironment } = createRequire(
  __filename,
)('@modern-js/app-tools-extensions/config');

function loadGeneratedPlugin(loadZephyr: () => unknown): ZephyrPlugin {
  const config = createAppModernConfig(
    'zephyr-config-test',
    shellApp,
    [],
    false,
  );
  const start = config.indexOf('const zephyrRspackPlugin =');
  const end = config.indexOf('const appId =', start);
  assert.ok(start >= 0 && end > start);
  // Keep the original import as well as the actual emitted hook. A runtime
  // import here would initialize the provider before its deploy gate.
  const zephyrImport = config.match(
    /^import[^\n]*zephyr-rspack-plugin[^\n]*\n/mu,
  );
  assert.ok(zephyrImport);
  const executable = transformSync(
    `${zephyrImport[0]}${config.slice(start, end)}module.exports = zephyrRspackPlugin();`,
    {
      loader: 'ts',
      format: 'cjs',
      target: 'node26',
      supported: { 'dynamic-import': false },
    },
  ).code;
  const module = { exports: undefined as unknown };
  vm.runInNewContext(executable, {
    module,
    exports: module.exports,
    getBuildConfigEnvironment,
    withBuildConfigEnvironment,
    require(specifier: string) {
      assert.equal(specifier, 'zephyr-rspack-plugin');
      return loadZephyr();
    },
  });
  return module.exports as ZephyrPlugin;
}

async function withEnvironment(
  token: string | undefined,
  run: () => void | Promise<void>,
) {
  const savedToken = process.env.ZE_CI_TOKEN;
  const savedFailBuild = process.env.ZE_FAIL_BUILD;
  try {
    if (token === undefined) delete process.env.ZE_CI_TOKEN;
    else process.env.ZE_CI_TOKEN = token;
    process.env.ZE_FAIL_BUILD = 'previous';
    await run();
  } finally {
    if (savedToken === undefined) delete process.env.ZE_CI_TOKEN;
    else process.env.ZE_CI_TOKEN = savedToken;
    if (savedFailBuild === undefined) delete process.env.ZE_FAIL_BUILD;
    else process.env.ZE_FAIL_BUILD = savedFailBuild;
  }
}

test('generated Zephyr config stays cold without a deploy token', async () => {
  await withEnvironment(undefined, () => {
    let imports = 0;
    let registrations = 0;
    const plugin = loadGeneratedPlugin(() => {
      imports++;
      throw new Error('Zephyr must stay cold during ordinary config loading');
    });
    plugin.setup({ modifyRspackConfig: () => registrations++ });
    assert.equal(imports, 0);
    assert.equal(registrations, 0);
    assert.equal(process.env.ZE_FAIL_BUILD, 'previous');
  });
});

test('generated Zephyr deploy hooks defer provider loading until Rspack invokes them', async () => {
  await withEnvironment('deploy-token', async () => {
    let imports = 0;
    let setups = 0;
    let handler: RspackHandler | undefined;
    const failure = new Error('native provider setup failed');
    const config = { plugins: [] };
    const plugin = loadGeneratedPlugin(() => {
      imports++;
      return {
        withZephyr() {
          return async (received: BuildConfig) => {
            setups++;
            assert.equal(received, config);
            assert.equal(process.env.ZE_FAIL_BUILD, 'true');
            throw failure;
          };
        },
      };
    });
    plugin.setup({ modifyRspackConfig: registered => (handler = registered) });
    assert.equal(imports, 0);
    assert.ok(handler);
    await assert.rejects(handler(config), error => error === failure);
    assert.equal(imports, 1);
    assert.equal(setups, 1);
    assert.equal(process.env.ZE_FAIL_BUILD, 'previous');
  });
});

test('generated Zephyr import errors propagate before an environment lease is acquired', async () => {
  await withEnvironment('deploy-token', async () => {
    let handler: RspackHandler | undefined;
    const failure = new Error('native provider import failed');
    const plugin = loadGeneratedPlugin(() => {
      throw failure;
    });
    plugin.setup({ modifyRspackConfig: registered => (handler = registered) });
    assert.ok(handler);
    await assert.rejects(handler({}), error => error === failure);
    assert.equal(process.env.ZE_FAIL_BUILD, 'previous');
  });
});
