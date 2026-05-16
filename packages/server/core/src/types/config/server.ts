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
      preload?: boolean | SSRPreload;
      inlineScript?: boolean;
      disablePrerender?: boolean;
      /**
       * Additional request header names removed from SSR payload serialization.
       * Sensitive headers are denylisted by default.
       */
      unsafeHeaders?: string[];
      /**
       * Enable app-level Module Federation SSR bridge path.
       * This flag should be enabled in both host and remote applications.
       * @default false
       */
      moduleFederationAppSSR?: boolean;
    };

export type SSRByEntries = Record<string, SSR>;

type SSRPreload = Record<string, unknown>;

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

export interface ServerTelemetryCanaryAutopilotUserConfig {
  /**
   * Enable automatic contract gate synchronization from a gate snapshot file.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Path to contract gate snapshot JSON file.
   *
   * @default ".modern/contract-gates.json"
   */
  gateSnapshotPath?: string;
  /**
   * Poll interval for reading gate snapshot changes.
   *
   * @default 15000
   */
  pollIntervalMs?: number;
  /**
   * Marks gate entries as failed when they are older than this threshold.
   *
   * @default 600000
   */
  gateStaleAfterMs?: number;
  /**
   * Runtime MF fallback signal ingestion.
   */
  runtimeFallbackSignal?: ServerTelemetryCanaryRuntimeFallbackSignalUserConfig;
  /**
   * Optional pluggable state store backend for contract gate snapshots.
   * When omitted, snapshots are read/written from gateSnapshotPath on local disk.
   */
  stateStore?: ServerTelemetryCanaryAutopilotStateStoreUserConfig;
}

export interface ServerTelemetryCanaryAutopilotStateStoreUserConfig {
  /**
   * Path or package name of a module that exports
   * `createContractGateSnapshotStore(context)`.
   */
  module: string;
  /**
   * Optional adapter-specific configuration.
   */
  options?: Record<string, unknown>;
}

export interface ServerTelemetryCanaryRuntimeFallbackSignalUserConfig {
  /**
   * Enable runtime MF fallback signal ingestion endpoint.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * HTTP endpoint path for runtime fallback events.
   *
   * @default "/_modern/contract-gates/runtime-fallback"
   */
  endpoint?: string;
  /**
   * Contract gate name updated by runtime fallback events.
   *
   * @default "runtime-mf-fallback-health"
   */
  gateName?: string;
  /**
   * How long a runtime fallback signal should hold gate failure status.
   *
   * @default 300000
   */
  failureHoldMs?: number;
  /**
   * Maximum accepted request body size in bytes.
   *
   * @default 16384
   */
  maxBodyBytes?: number;
  /**
   * Optional runtime trust policy for fallback signal ingestion.
   * Use this to restrict who can mutate canary contract gates.
   */
  trustPolicy?: ServerTelemetryCanaryRuntimeFallbackSignalTrustPolicyUserConfig;
  /**
   * Optional request authentication for runtime fallback signal endpoint.
   */
  auth?: ServerTelemetryCanaryRuntimeFallbackSignalAuthUserConfig;
  /**
   * Optional worker-lane pilot for runtime fallback snapshot persistence.
   * Disabled by default to keep baseline behavior deterministic.
   */
  workerLane?: ServerTelemetryCanaryRuntimeFallbackSignalWorkerLaneUserConfig;
}

export interface ServerTelemetryCanaryRuntimeFallbackSignalWorkerLaneUserConfig {
  /**
   * Enable off-main-thread persistence for runtime fallback gate snapshots.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Maximum time to wait for worker-lane completion before falling back to
   * main-thread persistence.
   *
   * @default 250
   */
  timeoutMs?: number;
}

export interface ServerTelemetryCanaryRuntimeFallbackSignalAuthUserConfig {
  /**
   * Enable auth guard for runtime fallback signal endpoint.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Header name carrying runtime fallback auth token.
   *
   * @default "x-modernjs-runtime-signal-token"
   */
  headerName?: string;
  /**
   * Expected token value. Prefer using expectedValueEnv in production.
   */
  expectedValue?: string;
  /**
   * Name of environment variable that stores expected token value.
   */
  expectedValueEnv?: string;
}

export interface ServerTelemetryCanaryRuntimeFallbackSignalTrustPolicyUserConfig {
  /**
   * Allowlist of app names accepted by runtime fallback signal endpoint.
   * Empty means no app-name allowlist check.
   */
  allowedApps?: string[];
  /**
   * Allowlist of entry origins accepted by runtime fallback signal endpoint.
   * Values should be URL origins (for example https://erp.example.com).
   * Empty means no entry-origin allowlist check.
   */
  allowedEntryOrigins?: string[];
  /**
   * Expected runtime digest per appName.
   */
  expectedRuntimeDigests?: Record<string, string>;
  /**
   * Require runtimeDigest to be present in signal payload metadata.
   *
   * @default false
   */
  enforceRuntimeDigest?: boolean;
  /**
   * Maximum accepted signals per app+origin window.
   *
   * @default 30
   */
  maxSignalsPerWindow?: number;
  /**
   * Sliding window size in milliseconds for maxSignalsPerWindow.
   *
   * @default 60000
   */
  windowMs?: number;
  /**
   * Drop duplicate fallback events with the same fingerprint during this window.
   *
   * @default 10000
   */
  dedupeWindowMs?: number;
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
  /**
   * Contract-gate autopilot settings.
   */
  autopilot?: ServerTelemetryCanaryAutopilotUserConfig;
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
  /**
   * Path to the tsconfig used by all server-side TypeScript stages:
   * BFF/api compile, custom server compile, runtime TypeScript register,
   * and downstream runtimes.
   *
   * @default <appDirectory>/tsconfig.json
   */
  tsconfigPath?: string;
}

export type ServerNormalizedConfig = ServerUserConfig;
