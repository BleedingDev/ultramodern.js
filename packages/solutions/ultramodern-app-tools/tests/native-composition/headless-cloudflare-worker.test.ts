import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import { createBuilderGenerator } from '@modern-js/app-tools/builder';
import { createAsyncHook, createPluginManager } from '@modern-js/plugin';
import type { CLIPluginAPI } from '@modern-js/plugin/cli';
import { rstest } from '@rstest/core';
import { ultramodernAppTools } from '../../src/native-composition';

rstest.mock('@modern-js/app-tools/builder', () => ({
  createBuilderGenerator: rstest.fn(),
}));

const getPlugin = () => {
  const plugin = ultramodernAppTools().usePlugins?.find(
    candidate => candidate.name === '@modern-js/headless-cloudflare-worker',
  );
  if (!plugin) {
    throw new Error('Headless Cloudflare worker plugin is missing.');
  }
  return plugin;
};

describe('headless Cloudflare worker build', () => {
  it('awaits the worker compiler before the release-envelope hook', async () => {
    const events: string[] = [];
    const build = rstest.fn(async () => {
      events.push('worker');
    });
    rstest
      .mocked(createBuilderGenerator)
      .mockResolvedValue(async () => ({ build }) as never);
    const releaseProbe: CliPlugin<AppTools> = {
      name: '@modern-js/ultramodern-release-envelope',
      setup(api) {
        api.onAfterBuild(async () => {
          events.push('envelope');
        });
      },
    };
    const manager = createPluginManager();
    manager.addPlugins([getPlugin(), releaseProbe]);
    const plugins = manager.getPlugins();
    expect(plugins.map(plugin => plugin.name)).toEqual([
      '@modern-js/headless-cloudflare-worker',
      '@modern-js/ultramodern-release-envelope',
    ]);
    const composedManager = createPluginManager();
    composedManager.addPlugins([ultramodernAppTools()]);
    const composedNames = composedManager
      .getPlugins()
      .map(plugin => plugin.name);
    expect(
      composedNames.indexOf('@modern-js/headless-cloudflare-worker'),
    ).toBeLessThan(
      composedNames.indexOf('@modern-js/ultramodern-release-envelope'),
    );

    const onAfterBuild = createAsyncHook<() => Promise<void>>();
    const api = {
      getAppContext: () => ({ apiOnly: true }),
      getNormalizedConfig: () => ({ deploy: { target: 'cloudflare' } }),
      onAfterBuild: onAfterBuild.tap,
    } as unknown as CLIPluginAPI<AppTools>;
    for (const plugin of plugins) {
      await plugin.setup?.(api as never);
    }
    await onAfterBuild.call();

    expect(events).toEqual(['worker', 'envelope']);
  });

  it('uses the native builder once for API-only Cloudflare before release validation', async () => {
    const build = rstest.fn(async () => undefined);
    const createBuilder = rstest.fn(async () => ({ build }));
    rstest
      .mocked(createBuilderGenerator)
      .mockResolvedValue(
        createBuilder as Awaited<ReturnType<typeof createBuilderGenerator>>,
      );
    const appContext = { apiOnly: true, appDirectory: '/app' };
    const normalizedConfig = { deploy: { target: 'cloudflare' } };
    let onAfterBuild: (() => Promise<void>) | undefined;
    const plugin = getPlugin();
    expect(plugin.post).toContain('@modern-js/ultramodern-release-envelope');
    await plugin.setup?.({
      getAppContext: () => appContext,
      getNormalizedConfig: () => normalizedConfig,
      onAfterBuild: handler => {
        onAfterBuild = handler;
      },
    } as unknown as CLIPluginAPI<AppTools>);

    await onAfterBuild?.();

    expect(createBuilder).toHaveBeenCalledWith({
      appContext,
      normalizedConfig,
    });
    expect(build).toHaveBeenCalledOnce();
  });

  it.each([
    { apiOnly: false, target: 'cloudflare' },
    { apiOnly: true, target: 'node' },
  ])('does not build a worker for $target with apiOnly=$apiOnly', async ({
    apiOnly,
    target,
  }) => {
    rstest.mocked(createBuilderGenerator).mockClear();
    let onAfterBuild: (() => Promise<void>) | undefined;
    await getPlugin().setup?.({
      getAppContext: () => ({ apiOnly }),
      getNormalizedConfig: () => ({ deploy: { target } }),
      onAfterBuild: handler => {
        onAfterBuild = handler;
      },
    } as unknown as CLIPluginAPI<AppTools>);

    await onAfterBuild?.();

    expect(createBuilderGenerator).not.toHaveBeenCalled();
  });
});
