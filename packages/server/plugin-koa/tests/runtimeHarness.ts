import {
  compatPlugin,
  createServerBase,
  type ServerPlugin,
} from '@modern-js/server-core';

type PluginFactory = (() => ServerPlugin) | ServerPlugin;

const DEFAULT_CONFIG = {
  html: {},
  output: {},
  source: {},
  tools: {},
  server: {},
  bff: {},
  dev: {},
  security: {},
};

const configStore: { value: Record<string, any> } = {
  value: {},
};

export const ConfigContext = {
  set(config: Record<string, any>) {
    configStore.value = config || {};
  },
  get() {
    return configStore.value || {};
  },
};

class TestServerManager {
  private readonly plugins: PluginFactory[];

  constructor(plugins: PluginFactory[] = []) {
    this.plugins = plugins;
  }

  clone() {
    return new TestServerManager([...this.plugins]);
  }

  usePlugin(...plugins: PluginFactory[]) {
    return new TestServerManager([...this.plugins, ...plugins]);
  }

  async init() {
    return this;
  }

  async prepareApiServer({ pwd, prefix }: { pwd: string; prefix: string }) {
    const runtimeConfig = ConfigContext.get();
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...runtimeConfig,
      bff: {
        ...DEFAULT_CONFIG.bff,
        ...(runtimeConfig.bff || {}),
      },
    };

    const server = createServerBase({
      pwd,
      config: mergedConfig as any,
      appContext: {
        apiDirectory: '',
        lambdaDirectory: '',
      },
    } as any);

    server.addPlugins([
      compatPlugin(),
      ...this.plugins.map(plugin =>
        typeof plugin === 'function' ? plugin() : plugin,
      ),
    ]);

    await server.init();
    return server.hooks.prepareApiServer.call({ pwd, prefix });
  }
}

export const serverManager = new TestServerManager();
