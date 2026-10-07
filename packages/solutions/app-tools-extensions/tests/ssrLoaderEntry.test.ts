import { applySSRLoaderEntry } from '../../app-tools/src/builder/shared/builderPlugins/adapterSSR';

const collectLoaderEntries = async (
  isServer: boolean,
  isServiceWorker: boolean,
) => {
  const entries: Record<string, string[]> = {};
  const chain = {
    entry: (name: string) => ({
      add: (request: string) => {
        (entries[name] ??= []).push(request);
      },
    }),
  };
  await applySSRLoaderEntry(
    chain as any,
    {
      appContext: {
        internalDirectory: '/app/node_modules/.modern-js',
        entrypoints: [{ entryName: 'index' }],
      },
      normalizedConfig: { server: { rsc: true } },
    } as any,
    isServer,
    isServiceWorker,
  );
  return entries;
};

describe('applySSRLoaderEntry', () => {
  it('mirrors the RSC server loader entry in the browser client', async () => {
    expect(await collectLoaderEntries(false, false)).toEqual({
      'index-server-loaders': ['data:text/javascript,export%20{};'],
    });
  });

  it('leaves the service worker loader entry to the worker route data handler', async () => {
    expect(await collectLoaderEntries(false, true)).toEqual({});
  });
});
