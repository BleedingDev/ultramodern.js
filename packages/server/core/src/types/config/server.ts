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

type PreloadLink = { url: string; as?: string; rel?: string };
type PreloadInclude = Array<string | PreloadLink>;
interface PreloadAttributes {
  script?: Record<string, boolean | string>;
  style?: Record<string, boolean | string>;
  image?: Record<string, boolean | string>;
  font?: Record<string, boolean | string>;
}
export type SSRPreload = {
  /** Include external preload links to enhance the page's performance by preloading additional resources. */
  include?: PreloadInclude;

  /** Utilize string matching to exclude specific preload links. */
  exclude?: RegExp | string;

  /** Disable preload when the User-Agent is matched.  */
  userAgentFilter?: RegExp | string;

  /** Include additional attributes to the Header Link.  */
  attributes?: PreloadAttributes;
};

export type SSR =
  | boolean
    | {
        forceCSR?: boolean;
        mode?: SSRMode;
        preload?: boolean | SSRPreload;
        inlineScript?: boolean;
        disablePrerender?: boolean;
        /**
         * Additional request header names removed from SSR payload serialization.
         * Sensitive headers are denylisted by default.
         */
        unsafeHeaders?: string[];
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

export interface ServerTelemetrySloUserConfig {
  /**
   * Queue utilization ratio threshold that emits SLO degradation alerts.
   *
   * @default 0.8
   */
  queueUtilizationWarnThreshold?: number;
  /**
   * Total dropped-envelope threshold that emits SLO degradation alerts.
   *
   * @default 1
   */
  queueDroppedWarnThreshold?: number;
  /**
   * Cooldown between SLO alert emissions for the same alert type.
   *
   * @default 60000
   */
  alertCooldownMs?: number;
}

export interface ServerTelemetryCanaryContractGateUserConfig {
  /**
   * Whether this contract gate currently passes.
   */
  passed: boolean;
  /**
   * Optional failure reason used for rollback diagnostics.
   */
  reason?: string;
}

export interface ServerTelemetryCanaryUserConfig {
  /**
   * Enable canary rollout/rollback orchestration.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Periodic canary evaluation interval in milliseconds.
   *
   * @default 15000
   */
  evaluationIntervalMs?: number;
  /**
   * Required consecutive healthy evaluations before promotion.
   *
   * @default 3
   */
  minConsecutiveHealthyEvaluations?: number;
  /**
   * Consecutive failing evaluations before automated rollback.
   *
   * @default 2
   */
  rollbackConsecutiveFailures?: number;
  /**
   * Maximum queue utilization ratio allowed during canary.
   *
   * @default 0.8
   */
  maxQueueUtilization?: number;
  /**
   * Maximum allowed total dropped envelopes during canary.
   *
   * @default 0
   */
  maxTotalDropped?: number;
  /**
   * Maximum allowed unhealthy exporters during canary.
   *
   * @default 0
   */
  maxUnhealthyExporters?: number;
  /**
   * Contract gate map used in rollout decisions.
   * `true` means passing, `false` means failing.
   */
  contractGates?: Record<
    string,
    boolean | ServerTelemetryCanaryContractGateUserConfig
  >;
}

export interface ServerTelemetryUserConfig {
  /**
   * Enable framework telemetry envelopes.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Service name in telemetry envelopes.
   *
   * @default server.metaName
   */
  service?: string;
  /**
   * Module name in telemetry envelopes.
   *
   * @default "server"
   */
  module?: string;
  /**
   * Environment name in telemetry envelopes.
   *
   * @default process.env.MODERN_ENV || process.env.NODE_ENV || "development"
   */
  environment?: string;
  /**
   * Sampling rate for telemetry events.
   *
   * @default 1
   */
  samplingRate?: number;
  /**
   * Flush interval in milliseconds.
   *
   * @default 1000
   */
  flushIntervalMs?: number;
  /**
   * Maximum envelopes in one emitted batch.
   *
   * @default 50
   */
  maxBatchSize?: number;
  /**
   * Maximum in-memory queue size.
   *
   * @default 1000
   */
  maxQueueSize?: number;
  /**
   * Envelope attribute keys to redact.
   */
  redactionKeys?: string[];
  /**
   * Control startup exporter health probe behavior.
   * When enabled (default), server initialization emits a startup probe and
   * marks exporters healthy/unhealthy before serving traffic.
   * When fail-loud mode is enabled (default), initialization throws if at
   * least one configured exporter is unhealthy.
   *
   * @default true
   */
  failLoudStartup?: boolean;
  /**
   * Queue backpressure/degradation SLO alert thresholds.
   */
  slo?: ServerTelemetrySloUserConfig;
  /**
   * Canary rollout and automated rollback orchestration policy.
   */
  canary?: ServerTelemetryCanaryUserConfig;
  exporters?: {
    /** OpenTelemetry HTTP exporter. */
    otlp?: ServerTelemetryExporterOptions;
    /** VictoriaMetrics Prometheus import exporter. */
    victoriaMetrics?: ServerTelemetryVictoriaMetricsOptions;
  };
}

export interface ServerUserConfig {
  routes?: Routes;
  publicRoutes?: Record<string, string>;
  ssr?: SSR;
  ssrByEntries?: SSRByEntries;
  baseUrl?: string | string[];
  port?: number;
  logger?: boolean | Record<string, any>;
  metrics?: boolean | Record<string, any>;
  telemetry?: ServerTelemetryUserConfig;
  enableMicroFrontendDebug?: boolean;
  watchOptions?: WatchOptions;
  compiler?: 'babel' | 'typescript';
  enableFrameworkExt?: boolean;
}

export type ServerNormalizedConfig = ServerUserConfig;
