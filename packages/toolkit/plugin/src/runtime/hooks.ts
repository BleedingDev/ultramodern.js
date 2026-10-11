import {
  createAsyncHook,
  createAsyncInterruptHook,
  createCollectSyncHook,
  createSyncHook,
} from '../hooks';
import type {
  ConfigFn,
  ExtendStreamSSRFn,
  ExtendStringSSRCollectorsFn,
  Hooks,
  OnBeforeRenderFn,
  OnRenderPreparedFn,
  OnRequestEndFn,
  PickContextFn,
  ResolveComponentFn,
  StringSSRCollectorsInfo,
  TransformRuntimeContextFn,
  WrapRootFn,
} from '../types/runtime/hooks';

export function initHooks<RuntimeConfig, RuntimeContext>(): Hooks<
  RuntimeConfig,
  RuntimeContext
> {
  const requestEnd = createCollectSyncHook<OnRequestEndFn<RuntimeContext>>();
  const onRequestEnd: Hooks<RuntimeConfig, RuntimeContext>['onRequestEnd'] = {
    tap(callback) {
      // Defer invocation so synchronous failures become settled outcomes too.
      requestEnd.tap(info => Promise.resolve().then(() => callback(info)));
    },
    async call(info) {
      const results = await Promise.allSettled(requestEnd.call(info));
      const errors = results.flatMap(result =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (errors.length === 1) {
        throw errors[0];
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Request completion hooks failed');
      }
    },
  };
  return {
    onBeforeRender:
      createAsyncInterruptHook<OnBeforeRenderFn<RuntimeContext>>(),
    onRenderPrepared: createAsyncHook<OnRenderPreparedFn<RuntimeContext>>(),
    onRequestEnd,
    wrapRoot: createSyncHook<WrapRootFn>(),
    resolveComponent: createSyncHook<ResolveComponentFn>(),
    pickContext: createSyncHook<PickContextFn<RuntimeContext>>(),
    transformRuntimeContext:
      createSyncHook<TransformRuntimeContextFn<RuntimeContext>>(),
    config: createCollectSyncHook<ConfigFn<RuntimeConfig>>(),
    extendStringSSRCollectors:
      createCollectSyncHook<
        ExtendStringSSRCollectorsFn<StringSSRCollectorsInfo<RuntimeContext>>
      >(),
    extendStreamSSR: createCollectSyncHook<ExtendStreamSSRFn<RuntimeContext>>(),
  };
}
