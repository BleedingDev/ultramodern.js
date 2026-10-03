import {
  type AsyncHook,
  type CollectAsyncHook,
  type CollectSyncHook,
  createAsyncHook,
  createAsyncInterruptHook,
  createAsyncPipelineHook,
  createCollectAsyncHook,
  createCollectSyncHook,
  createSyncHook,
  type Plugin,
  type PluginHook,
  type PluginManager,
  type SyncHook,
  type TransformFunction,
} from '../src/cli';
import * as genericHooks from '../src/hooks';
import { createPluginManager } from '../src/manager';

describe('neutral CLI exports', () => {
  it('exposes the existing hook factories through the CLI entry', () => {
    expect(createAsyncHook).toBe(genericHooks.createAsyncHook);
    expect(createAsyncInterruptHook).toBe(
      genericHooks.createAsyncInterruptHook,
    );
    expect(createAsyncPipelineHook).toBe(genericHooks.createAsyncPipelineHook);
    expect(createCollectAsyncHook).toBe(genericHooks.createCollectAsyncHook);
    expect(createCollectSyncHook).toBe(genericHooks.createCollectSyncHook);
    expect(createSyncHook).toBe(genericHooks.createSyncHook);
  });

  it('lets CLI consumers register generic hooks and plugins using the same implementations', async () => {
    const sync: SyncHook<(value: number) => number> = createSyncHook();
    const asyncHook: AsyncHook<(value: number) => Promise<number>> =
      createAsyncHook();
    const collectSync: CollectSyncHook<(value: number) => number> =
      createCollectSyncHook();
    const collectAsync: CollectAsyncHook<(value: number) => Promise<number>> =
      createCollectAsyncHook();
    const transform: TransformFunction<number> = value => value + 1;
    const hook: PluginHook<(value: number) => number> = sync;
    const plugin: Plugin = {
      name: 'neutral-cli-fixture',
      registryHooks: { fixture: hook },
    };
    const manager: PluginManager = createPluginManager();
    manager.addPlugins([plugin]);
    expect(manager.getPlugins()).toEqual([plugin]);
    sync.tap(value => value + 1);
    asyncHook.tap(async value => value + 2);
    collectSync.tap(value => value + 3);
    collectAsync.tap(async value => value + 4);
    expect(sync.call(1)).toBe(2);
    expect(await asyncHook.call(1)).toBe(3);
    expect(collectSync.call(1)).toEqual([4]);
    expect(await collectAsync.call(1)).toEqual([5]);
    expect(await transform(1)).toBe(2);
  });
});
