import { createPluginManager } from '../src/manager';
import type { Plugin } from '../src/types/plugin';

const pluginModern = (): Plugin<{}, {}> => {
  return {
    name: 'pluginModern',
    setup() {
      console.log('run plugin Modern');
    },
  };
};

const pluginInner = (): Plugin<{}, {}> => {
  return {
    name: 'pluginInner',
    usePlugins: [pluginModern()],
    pre: ['pluginModern'],
    setup() {
      console.log('run plugin Inner');
    },
  };
};

const pluginPost = (): Plugin<{}, {}> => {
  return {
    name: 'pluginPost',
    usePlugins: [pluginModern()],
    post: ['pluginModern'],
    setup() {
      console.log('run plugin Post');
    },
  };
};

const pluginCustom = (): Plugin<{}, {}> => {
  return {
    name: 'pluginCustom',
    post: ['pluginInner', 'pluginPost'],
    setup() {
      console.log('run plugin Custom');
    },
  };
};

describe('plugin order', () => {
  it('handle add plugin', () => {
    const manager = createPluginManager<{}, {}>();
    manager.addPlugins([pluginInner()]);
    const plugins = manager.getPlugins().map(plugin => plugin.name);
    expect(plugins).toEqual(['pluginModern', 'pluginInner']);
  });

  it('handle custom plugin', () => {
    const manager = createPluginManager<{}, {}>();
    manager.addPlugins([pluginModern(), pluginCustom()]);
    const plugins = manager.getPlugins().map(plugin => plugin.name);
    expect(plugins).toEqual(['pluginModern', 'pluginCustom']);
  });

  it('handle use plugin', () => {
    const manager = createPluginManager<{}, {}>();
    manager.addPlugins([pluginInner(), pluginCustom()]);
    const plugins = manager.getPlugins().map(plugin => plugin.name);
    expect(plugins).toEqual(['pluginCustom', 'pluginModern', 'pluginInner']);
  });

  it('handle use plugin but add post order', () => {
    const manager = createPluginManager<{}, {}>();
    manager.addPlugins([pluginPost(), pluginCustom()]);
    const plugins = manager.getPlugins().map(plugin => plugin.name);
    expect(plugins).toEqual(['pluginCustom', 'pluginPost', 'pluginModern']);
  });

  it('handles empty plugin list', () => {
    const manager = createPluginManager();
    manager.addPlugins([]);
    const plugins = manager.getPlugins().map(plugin => plugin.name);
    expect(plugins).toEqual([]);
  });

  it('handles single plugin without dependencies', () => {
    const manager = createPluginManager<{}, {}>();
    manager.addPlugins([pluginModern()]);
    const plugins = manager.getPlugins().map(plugin => plugin.name);
    expect(plugins).toEqual(['pluginModern']);
  });

  it('detects circular dependencies', () => {
    const pluginCircular = (): Plugin<{}, {}> => {
      return {
        name: 'pluginCircular',
        pre: ['pluginInner'],
        post: ['pluginModern'],
        setup() {
          console.log('run plugin Circular');
        },
      };
    };

    const manager = createPluginManager<{}, {}>();
    manager.addPlugins([pluginInner(), pluginCircular()]);
    expect(() => manager.getPlugins()).toThrow(
      'Circular dependency detected: pluginInner',
    );
  });

  it('retains a typed setup API and the original nested plugin instances', async () => {
    type API = { record(value: number): void };
    type Context = { application: string };
    const manager = createPluginManager<API, Context>();
    const child: Plugin<API, Context> = {
      name: 'typed-child',
      setup(api) {
        api.record(42);
      },
    };
    const parent: Plugin<API, Context> = {
      name: 'typed-parent',
      usePlugins: [child],
    };
    manager.addPlugins([parent, false]);
    const plugins: Plugin<API, Context>[] = manager.getPlugins();
    expect(plugins).toEqual([child, parent]);
    expect(plugins[0]).toBe(child);
    const values: number[] = [];
    await plugins[0].setup?.({ record: value => values.push(value) });
    expect(values).toEqual([42]);
    manager.clear();
    expect(manager.getPlugins()).toEqual([]);
  });
});
