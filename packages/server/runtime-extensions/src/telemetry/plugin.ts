import { parseTraceparent } from '@modern-js/create-request/server';
import type {
  Context,
  Next,
  ServerEnv,
  ServerPlugin,
  ServerTelemetryUserConfig,
} from '@modern-js/server-core';
import type { CoreMonitor } from '@modern-js/types';
import { logger } from '@modern-js/utils';
import { parseServerRuntimeExtensionsEnv } from '../env';
import {
  TelemetryRegistry,
  type TelemetryRegistryOptions,
  toTelemetryEnvelope,
} from '../telemetryCore';
import { setupTelemetryHealthMonitoring } from './healthSetup';
import { registerTelemetryLifecycle } from './lifecycle';
import {
  createRuntimeFallbackSignalMiddleware,
  createRuntimeStatusMiddleware,
} from './runtimeEndpoints';

export {
  createRuntimeFallbackSignalRuntimeState,
  createRuntimeSignalError,
  DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT,
  DEFAULT_RUNTIME_STATUS_ENDPOINT,
  enforceRuntimeFallbackSignalAuthToken,
  enforceRuntimeFallbackSignalTrustPolicy,
  getRuntimeSignalErrorStatusCode,
  normalizeRequiredRuntimeFallbackSignalAuthConfig,
  normalizeRuntimeFallbackSignalAuthConfig,
  normalizeRuntimeFallbackTrustPolicy,
  parseRuntimeFallbackSignalPayloadFromRawBody,
  type RuntimeFallbackSignalAuthConfig,
  type RuntimeFallbackSignalRuntimeState,
  type RuntimeFallbackSignalSource,
  type RuntimeFallbackSignalTrustContext,
  type RuntimeFallbackSignalTrustPolicy,
  type RuntimeSignalError,
  type RuntimeSignalErrorCode,
  resolveRuntimeFallbackSignalEndpoint,
} from '../runtimeFallbackSignal';
export {
  createOtlpTelemetryExporter,
  createTelemetryAwareMetrics,
  createVictoriaMetricsTelemetryExporter,
  type OtlpExporterOptions,
  type TelemetryContractGateStatus,
  type TelemetryEnvelope,
  type TelemetryExporter,
  type TelemetryExporterHealthStatus,
  type TelemetryHealthEvaluation,
  type TelemetryHealthFailure,
  type TelemetryHealthFailureReason,
  TelemetryHealthMonitor,
  type TelemetryHealthMonitorOptions,
  type TelemetryHealthState,
  type TelemetryHealthStatusSnapshot,
  type TelemetryHealthTransition,
  type TelemetryQueueStats,
  TelemetryRegistry,
  type TelemetryRegistryOptions,
  type TelemetrySignalType,
  type TelemetrySloAlert,
  type TelemetrySloAlertType,
  TelemetryStartupHealthError,
  type VictoriaMetricsExporterOptions,
} from '../telemetryCore';

export const hasEnabledTelemetryExporters = (
  config: ServerTelemetryUserConfig | undefined,
) =>
  Boolean(
    config?.exporters?.otlp?.enabled ||
      config?.exporters?.victoriaMetrics?.enabled,
  );

/**
 * Builds the registry SLO options from `server.telemetry.slo`, attaching a
 * logger sink so threshold breaches surface as server warnings (parity with
 * the pre-extraction prod-server harness).
 */
export const resolveTelemetrySloOptions = (
  sloConfig: ServerTelemetryUserConfig['slo'],
  warnSink: (message: string) => void = message => logger.warn(message),
): NonNullable<TelemetryRegistryOptions['slo']> => ({
  queueUtilizationWarnThreshold: sloConfig?.queueUtilizationWarnThreshold,
  queueDroppedWarnThreshold: sloConfig?.queueDroppedWarnThreshold,
  alertCooldownMs: sloConfig?.alertCooldownMs,
  onAlert: alert => {
    warnSink(
      `[telemetry.slo] ${alert.type} threshold=${alert.threshold} value=${alert.value} depth=${alert.queueDepth}/${alert.queueCapacity} dropped=${alert.totalDropped}`,
    );
  },
});

export const injectTelemetryPlugin = (): ServerPlugin => ({
  name: '@modern-js/inject-telemetry',
  setup(api) {
    const serverConfig = api.getServerConfig();
    const telemetryConfig = serverConfig?.server?.telemetry;
    if (!telemetryConfig) {
      return;
    }

    if (
      telemetryConfig.enabled !== true &&
      !hasEnabledTelemetryExporters(telemetryConfig)
    ) {
      return;
    }

    const { middlewares, metaName, appDirectory } = api.getServerContext();
    const serviceName = telemetryConfig.service || metaName || 'modern-js';
    const moduleName = telemetryConfig.module || 'server';
    const environmentName =
      telemetryConfig.environment ||
      parseServerRuntimeExtensionsEnv().environmentName;

    const registry = new TelemetryRegistry({
      service: serviceName,
      module: moduleName,
      environment: environmentName,
      samplingRate: telemetryConfig.samplingRate,
      flushIntervalMs: telemetryConfig.flushIntervalMs,
      maxBatchSize: telemetryConfig.maxBatchSize,
      maxQueueSize: telemetryConfig.maxQueueSize,
      redactionKeys: telemetryConfig.redactionKeys,
      slo: resolveTelemetrySloOptions(telemetryConfig.slo),
    });

    const {
      healthMonitor,
      gateSnapshotStorePromise,
      runtimeFallbackSignalConfig,
      runtimeStatusAuthConfig,
    } = setupTelemetryHealthMonitoring({
      registry,
      appDirectory,
      legacyHealthConfig: telemetryConfig.canary,
    });

    if (runtimeFallbackSignalConfig) {
      middlewares.push(
        createRuntimeFallbackSignalMiddleware(runtimeFallbackSignalConfig),
      );
    }
    middlewares.push(
      createRuntimeStatusMiddleware({
        registry,
        healthMonitor,
        runtimeFallbackSignalConfig,
        runtimeStatusAuthConfig,
      }),
    );

    middlewares.push({
      name: 'inject-telemetry',
      handler: async (c: Context<ServerEnv>, next: Next) => {
        const monitors = c.get('monitors');
        if (monitors) {
          const traceContext = parseTraceparent(c.req.header('traceparent'));
          const monitor: CoreMonitor = event => {
            registry.enqueue(
              toTelemetryEnvelope(event, {
                service: serviceName,
                module: moduleName,
                environment: environmentName,
                traceId: traceContext?.traceId,
                spanId: traceContext?.spanId,
                attributes: {
                  requestMethod: c.req.method,
                  requestPath: c.req.path,
                },
              }),
            );
          };
          monitors.push(monitor);
        }

        await next();
      },
    });

    registerTelemetryLifecycle({
      api,
      registry,
      telemetryConfig,
      legacyHealthConfig: telemetryConfig.canary,
      healthMonitor,
      gateSnapshotStorePromise,
      appDirectory,
    });
  },
});
