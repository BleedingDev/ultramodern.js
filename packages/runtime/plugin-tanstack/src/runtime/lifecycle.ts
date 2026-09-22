/**
 * The router runtime state helpers are owned by @modern-js/runtime-extensions (the same
 * implementation backs the built-in react-router provider and the SSR
 * pipeline). This module only re-exports them so every router provider
 * writes to the exact same runtime-context extension slot.
 */

import type { RouterLifecycleContext as NativeRouterLifecycleContext } from '@modern-js/runtime/context';
import type {
  InternalRouterServerSnapshot,
  RouterRouteMatchSnapshot,
} from '@modern-js/runtime-extensions/router-state';

export type RouterLifecycleContext = NativeRouterLifecycleContext & {
  matches?: RouterRouteMatchSnapshot[];
  cleanup?: () => void | Promise<void>;
  serverSnapshot?: InternalRouterServerSnapshot;
};
export {
  applyRouterRuntimeState,
  applyRouterServerPrepareResult,
  createRouterServerSnapshot,
  getRouterRuntimeState,
  getRouterServerSnapshot,
  type RouterLifecyclePhase,
} from '@modern-js/runtime-extensions/router-state';
