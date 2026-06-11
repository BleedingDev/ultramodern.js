/**
 * The router runtime state helpers are owned by @modern-js/runtime (the same
 * implementation backs the built-in react-router provider and the SSR
 * pipeline). This module only re-exports them so every router provider
 * writes to the exact same runtime-context extension slot.
 */
export {
  applyRouterRuntimeState,
  applyRouterServerPrepareResult,
  createRouterRuntimeState,
  createRouterServerSnapshot,
  getRouterRuntimeState,
  getRouterServerSnapshot,
  type RouterLifecycleContext,
  type RouterLifecyclePhase,
} from '@modern-js/runtime/context';
