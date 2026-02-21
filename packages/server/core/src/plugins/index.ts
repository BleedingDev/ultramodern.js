export {
  renderPlugin,
  injectRenderHandlerPlugin,
  type InjectRenderHandlerOptions,
  getRenderHandler,
} from './render';
export { faviconPlugin } from './favicon';
export { injectServerTiming, injectloggerPlugin } from './monitors';
export {
  TelemetryRegistry,
  createOtlpTelemetryExporter,
  createVictoriaMetricsTelemetryExporter,
  injectTelemetryPlugin,
  type OtlpExporterOptions,
  type TelemetryEnvelope,
  type TelemetryExporter,
  type TelemetryRegistryOptions,
  type TelemetrySignalType,
  type VictoriaMetricsExporterOptions,
} from './telemetry';
export { processedByPlugin } from './processedBy';
export { logPlugin } from './log';
export {
  createDefaultPlugins,
  type CreateDefaultPluginsOptions,
} from './default';
export { compatPlugin, handleSetupResult } from './compat';
export { injectConfigMiddlewarePlugin } from './middlewares';
