import {
  createUltramodernReleaseEnvelopePlugin,
  type ReleaseEnvelopePluginApi,
} from '../src/release-envelope/plugin';

interface TestReleaseEnvelopeConfig {
  deploy: { target: string };
  releaseChannel: string;
}

interface ReleaseEnvelopeLifecycleHandlers {
  afterBuild: Array<() => Promise<void>>;
  afterDeploy: Array<() => Promise<void>>;
  beforeDeploy: Array<() => Promise<void>>;
}

describe('release-envelope plugin type boundary', () => {
  it('preserves the concrete config type and registers each lifecycle once', async () => {
    const lifecycle: ReleaseEnvelopeLifecycleHandlers = {
      afterBuild: [],
      afterDeploy: [],
      beforeDeploy: [],
    };
    const config: TestReleaseEnvelopeConfig = {
      deploy: { target: 'vercel' },
      releaseChannel: 'stable',
    };
    const resolvedConfigs: TestReleaseEnvelopeConfig[] = [];
    const plugin = createUltramodernReleaseEnvelopePlugin({
      resolveDeployTarget: concreteConfig => {
        resolvedConfigs.push(concreteConfig);
        return concreteConfig.deploy.target;
      },
    });
    const api: ReleaseEnvelopePluginApi<TestReleaseEnvelopeConfig> = {
      getAppContext: () => ({
        apiOnly: false,
        appDirectory: '/app',
        distDirectory: '/app/dist',
        metaName: 'modern-js',
      }),
      getNormalizedConfig: () => config,
      onAfterBuild: handler => lifecycle.afterBuild.push(handler),
      onAfterDeploy: handler => lifecycle.afterDeploy.push(handler),
      onBeforeDeploy: handler => lifecycle.beforeDeploy.push(handler),
    };

    plugin.setup(api);

    expect(lifecycle.afterBuild).toHaveLength(1);
    expect(lifecycle.beforeDeploy).toHaveLength(1);
    expect(lifecycle.afterDeploy).toHaveLength(1);

    await lifecycle.afterBuild[0]();
    await lifecycle.beforeDeploy[0]();
    await lifecycle.afterDeploy[0]();

    expect(resolvedConfigs).toEqual([config, config, config]);
  });
});
