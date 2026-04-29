import type { RouterConfig } from './router/internal';

export type { RuntimeConfig } from './common';
export { isBrowser } from './common';
export type { RuntimePlugin } from './core';
export {
  defineRuntimeConfig,
  RuntimeContext,
  useRuntimeContext,
} from './core';

export { getMonitors } from './core/context/monitors';
export { getRequest } from './core/context/request';
export { redirect, setHeaders, setStatus } from './core/context/response';
export type { TRuntimeContext } from './core/context/runtime';

export type { RouterConfig };
