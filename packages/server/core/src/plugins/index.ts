export { compatPlugin, handleSetupResult } from './compat';
export {
  type CreateDefaultPluginsOptions,
  createDefaultPlugins,
} from './default';
export { faviconPlugin } from './favicon';
export { logPlugin } from './log';
export { injectConfigMiddlewarePlugin } from './middlewares';
export { injectloggerPlugin, injectServerTiming } from './monitors';
export { processedByPlugin } from './processedBy';
export {
  getRenderHandler,
  type InjectRenderHandlerOptions,
  injectRenderHandlerPlugin,
  renderPlugin,
} from './render';
