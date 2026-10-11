import {
  type FederationInstance,
  getFederationHost,
  loadFederatedModule,
  remoteBrowserAssets,
} from '../src/federation';

describe('application-owned federation', () => {
  test('captures each compiler host independently of initialization order', async () => {
    const first: FederationInstance = {
      loadRemote: async <T>() => ({ default: 'first' }) as T,
    };
    const second: FederationInstance = {
      loadRemote: async <T>() => ({ default: 'second' }) as T,
    };
    const binding = { instance: () => first };
    const host = getFederationHost(binding);
    expect(getFederationHost({ instance: () => second })).toBe(second);
    expect(host).toBe(first);
    expect(await loadFederatedModule(host, 'remote/Widget')).toEqual({
      default: 'first',
    });
    expect(await loadFederatedModule(second, 'remote/Widget')).toEqual({
      default: 'second',
    });
  });

  test('rejects absent and unavailable runtimes without consulting another host', async () => {
    expect(getFederationHost(undefined)).toBeUndefined();
    expect(() => getFederationHost({ instance: () => null! })).toThrow(
      'runtime has not started',
    );
    await expect(
      loadFederatedModule(undefined, 'remote/Widget'),
    ).rejects.toThrow('no Module Federation runtime');
    await expect(
      loadFederatedModule({ loadRemote: async () => null }, 'remote/Widget'),
    ).rejects.toThrow('unavailable');
  });

  test('resolves only the loaded expose and deduplicates its streamed CSS', () => {
    const remoteInfo = {};
    const instance: FederationInstance = {
      loadRemote: async () => null,
      remoteHandler: {
        idToRemoteMap: {
          'remote/Widget': { name: 'remote', expose: './Widget' },
        },
      },
      moduleCache: new Map([['remote', { remoteInfo }]]),
      snapshotHandler: {
        getGlobalRemoteInfo: info => {
          expect(info).toBe(remoteInfo);
          return {
            remoteSnapshot: {
              publicPath: 'https://remote.example/assets',
              remoteEntry: 'remoteEntry.js',
              modules: [
                {
                  modulePath: './Other',
                  assets: { css: { sync: ['unrelated.css'] } },
                },
                {
                  modulePath: './Widget',
                  assets: {
                    js: {
                      sync: ['widget.js', 'https://cdn.example/shared.js'],
                    },
                    css: {
                      sync: ['widget.css'],
                      async: ['widget.css', 'lazy.css'],
                    },
                  },
                },
              ],
            },
          };
        },
      },
    };
    expect(remoteBrowserAssets(instance, 'remote/Widget')).toEqual({
      js: [
        'https://remote.example/assets/remoteEntry.js',
        'https://remote.example/assets/widget.js',
        'https://cdn.example/shared.js',
      ],
      css: [
        'https://remote.example/assets/widget.css',
        'https://remote.example/assets/lazy.css',
      ],
    });
    expect(remoteBrowserAssets(instance, 'remote/Missing')).toBeUndefined();
  });
});
