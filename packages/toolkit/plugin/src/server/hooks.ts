import { createAsyncHook } from '../hooks';
import type { AsyncHook } from '../types/hooks';
import type {
  ModifyConfigFn,
  OnPrepareFn,
  OnResetFn,
} from '../types/server/hooks';
import type { DeepPartial } from '../types/utils';

export type { ModifyConfigFn, OnPrepareFn, OnResetFn };

export function initHooks<Config>(): Hooks<Config> {
  return {
    modifyConfig: createAsyncHook<ModifyConfigFn<DeepPartial<Config>>>(),
    onPrepare: createAsyncHook<OnPrepareFn>(),
    onReset: createAsyncHook<OnResetFn>(),
  };
}

export type Hooks<Config> = {
  modifyConfig: AsyncHook<ModifyConfigFn<DeepPartial<Config>>>;
  onPrepare: AsyncHook<OnPrepareFn>;
  onReset: AsyncHook<OnResetFn>;
};
