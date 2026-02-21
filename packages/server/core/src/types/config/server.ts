import type { SSRMode } from '@modern-js/types';
import type { WatchOptions } from '@modern-js/utils';

type Route =
  | string
  | string[]
  | {
      route?: string | string[];
      disableSpa?: boolean;
      resHeaders?: Record<string, unknown>;
    };
export type Routes = Record<string, Route>;

export type SSR =
  | boolean
  | {
      forceCSR?: boolean;
      mode?: SSRMode;
      inlineScript?: boolean;
      unsafeHeaders?: string[];
      loaderFailureMode?: 'clientRender' | 'errorBoundary';
      /**
       * Enable app-level Module Federation SSR bridge path in alpha mode.
       * This flag should be enabled in both host and remote applications.
       * @default false
       */
      moduleFederationAppSSRAlpha?: boolean;
    };

export type SSRByEntries = Record<string, SSR>;

export interface ServerTelemetryExporterOptions {
  enabled?: boolean;
  endpoint?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ServerTelemetryVictoriaMetricsOptions
  extends ServerTelemetryExporterOptions {
  metricPrefix?: string;
}

export interface ServerTelemetryUserConfig {
  /**
   * Enable framework telemetry envelope emission.
   * @default false
   */
  enabled?: boolean;
  /**
   * Logical service name attached to every telemetry envelope.
   * @default server.metaName
   */
  service?: string;
  /**
   * Logical module name attached to every telemetry envelope.
   * @default "server"
   */
  module?: string;
  /**
   * Environment attached to every telemetry envelope.
   * @default process.env.NODE_ENV || "development"
   */
  environment?: string;
  /**
   * Sampling rate for monitor events.
   * @default 1
   */
  samplingRate?: number;
  /**
   * Flush window in milliseconds for exporter batches.
   * @default 1000
   */
  flushIntervalMs?: number;
  /**
   * Maximum envelopes in one emitted batch.
   * @default 50
   */
  maxBatchSize?: number;
  /**
   * Maximum envelopes buffered before backpressure drops oldest.
   * @default 1000
   */
  maxQueueSize?: number;
  /**
   * Envelope attribute keys that should be redacted.
   */
  redactionKeys?: string[];
  exporters?: {
    /**
     * OpenTelemetry HTTP exporter.
     */
    otlp?: ServerTelemetryExporterOptions;
    /**
     * VictoriaMetrics Prometheus import exporter.
     */
    victoriaMetrics?: ServerTelemetryVictoriaMetricsOptions;
  };
}

export interface ServerUserConfig {
  publicDir?: string | string[];
  routes?: Routes;
  /**
   * Experimenal, it is not recommended to use it now
   */
  ssrByRouteIds?: string[];
  publicRoutes?: Record<string, string>;
  ssr?: SSR;
  ssrByEntries?: SSRByEntries;
  rsc?: boolean;
  baseUrl?: string | string[];
  port?: number;
  watchOptions?: WatchOptions;
  compiler?: 'typescript';
  /**
   * @description use json script tag instead of inline script
   * @default false
   */
  useJsonScript?: boolean;
  logger?: boolean | Record<string, unknown>;
  telemetry?: ServerTelemetryUserConfig;
  /**
   * @description disable hook middleware for performance
   * @default false
   */
  disableHook?: boolean;
}

export type ServerNormalizedConfig = ServerUserConfig;
