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
import { ContractGateAutopilot } from '../contractGateAutopilot';
import {
  type ContractGateSnapshotStore,
  DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH,
  resolveContractGateSnapshotPath,
  resolveContractGateSnapshotStore,
} from '../contractGateSnapshotStore';
import { parseServerRuntimeExtensionsEnv } from '../env';
import {
  createRuntimeFallbackSignalRuntimeState,
  DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS,
  DEFAULT_RUNTIME_FALLBACK_GATE_NAME,
  DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES,
  DEFAULT_RUNTIME_STATUS_ENDPOINT,
  enforceRuntimeFallbackSignalAuth,
  enforceRuntimeFallbackSignalAuthToken,
  enforceRuntimeFallbackSignalTrustPolicy,
  getRuntimeSignalErrorStatusCode,
  normalizeRequiredRuntimeFallbackSignalAuthConfig,
  normalizeRuntimeFallbackSignalAuthConfig,
  normalizeRuntimeFallbackTrustPolicy,
  parseRuntimeFallbackSignalPayload,
  persistRuntimeFallbackContractGate,
  type RuntimeFallbackSignalAuthConfig,
  type RuntimeFallbackSignalConfig,
  type RuntimeSignalError,
  resolveRuntimeFallbackSignalEndpoint,
} from '../runtimeFallbackSignal';
import {
  createOtlpTelemetryExporter,
  createVictoriaMetricsTelemetryExporter,
  maybeWarnLegacyOtlpEndpoint,
  type TelemetryCanaryDecision,
  TelemetryCanaryOrchestrator,
  TelemetryRegistry,
  type TelemetryRegistryOptions,
  toTelemetryEnvelope,
} from '../telemetryCore';

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
  type TelemetryCanaryAction,
  type TelemetryCanaryContractGateStatus,
  type TelemetryCanaryDecision,
  type TelemetryCanaryFailure,
  type TelemetryCanaryFailureReason,
  TelemetryCanaryOrchestrator,
  type TelemetryCanaryOrchestratorOptions,
  type TelemetryCanaryState,
  type TelemetryCanaryStatusSnapshot,
  type TelemetryEnvelope,
  type TelemetryExporter,
  type TelemetryExporterHealthStatus,
  type TelemetryQueueStats,
  TelemetryRegistry,
  type TelemetryRegistryOptions,
  type TelemetrySignalType,
  type TelemetrySloAlert,
  type TelemetrySloAlertType,
  TelemetryStartupHealthError,
  type VictoriaMetricsExporterOptions,
} from '../telemetryCore';

function emitCanaryDecisionMetric(
  registry: TelemetryRegistry,
  decision: TelemetryCanaryDecision,
  action: 'promote' | 'rollback',
) {
  try {
    registry.enqueueMetric({
      name: `telemetry.canary.${action}`,
      value: 1,
      unit: 'count',
      tags: {
        action,
        state: decision.state,
        failures: String(decision.failures.length),
      },
    });
  } catch (_error) {
    // Canary decision metrics are best-effort and must never break request flow.
  }
}

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

const getRequestRemoteAddress = (c: Context<ServerEnv>) => {
  const env = c.env as
    | {
        node?: {
          req?: {
            socket?: {
              remoteAddress?: string;
            };
          };
        };
      }
    | undefined;
  const remoteAddress = env?.node?.req?.socket?.remoteAddress;
  return typeof remoteAddress === 'string' && remoteAddress.trim().length > 0
    ? remoteAddress.trim()
    : undefined;
};

/**
 * Active telemetry lane disposers, flushed by a single shared process
 * `beforeExit` hook (a per-lane listener would accumulate listeners across
 * dev-server restarts and embedded multi-server setups).
 */
const activeTelemetryLaneClosers = new Set<() => Promise<void>>();
let telemetryBeforeExitHookInstalled = false;
const ensureTelemetryBeforeExitHook = () => {
  if (telemetryBeforeExitHookInstalled) {
    return;
  }
  telemetryBeforeExitHookInstalled = true;
  process.on('beforeExit', () => {
    for (const close of [...activeTelemetryLaneClosers]) {
      void close();
    }
  });
};

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

    let canaryOrchestrator: TelemetryCanaryOrchestrator | undefined;
    let contractGateAutopilot: ContractGateAutopilot | undefined;
    let runtimeFallbackSignalConfig: RuntimeFallbackSignalConfig | undefined;
    let runtimeStatusAuthConfig: RuntimeFallbackSignalAuthConfig | undefined;
    let gateSnapshotStorePromise:
      | Promise<ContractGateSnapshotStore>
      | undefined;

    const canaryConfig = telemetryConfig.canary;
    if (canaryConfig?.enabled) {
      const contractGates = canaryConfig.contractGates as
        | Record<string, boolean | { passed: boolean; reason?: string }>
        | undefined;

      canaryOrchestrator = new TelemetryCanaryOrchestrator({
        registry,
        evaluationIntervalMs: canaryConfig.evaluationIntervalMs,
        minConsecutiveHealthyEvaluations:
          canaryConfig.minConsecutiveHealthyEvaluations,
        rollbackConsecutiveFailures: canaryConfig.rollbackConsecutiveFailures,
        maxQueueUtilization: canaryConfig.maxQueueUtilization,
        maxTotalDropped: canaryConfig.maxTotalDropped,
        maxUnhealthyExporters: canaryConfig.maxUnhealthyExporters,
        requiredContractGates: Object.keys(contractGates || {}),
        onPromote: decision => {
          emitCanaryDecisionMetric(registry, decision, 'promote');
        },
        onRollback: decision => {
          emitCanaryDecisionMetric(registry, decision, 'rollback');
        },
      });

      if (contractGates) {
        canaryOrchestrator.setContractGates(contractGates);
      }

      const autopilotEnabled = canaryConfig.autopilot?.enabled ?? true;
      if (autopilotEnabled) {
        const gateSnapshotPath = resolveContractGateSnapshotPath(
          appDirectory,
          canaryConfig.autopilot?.gateSnapshotPath,
        );
        gateSnapshotStorePromise = resolveContractGateSnapshotStore({
          appDirectory,
          gateSnapshotPath:
            gateSnapshotPath || DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH,
          stateStore: canaryConfig.autopilot?.stateStore,
        });

        const runtimeSignalConfig =
          canaryConfig.autopilot?.runtimeFallbackSignal;
        // The signal endpoint can persist failing contract gates and force
        // the canary orchestrator into rollback, so it is opt-in (default
        // OFF) and requires a configured auth token when enabled.
        const runtimeSignalEnabled = runtimeSignalConfig?.enabled === true;
        if (runtimeSignalEnabled && gateSnapshotStorePromise) {
          runtimeFallbackSignalConfig = {
            endpoint: resolveRuntimeFallbackSignalEndpoint(
              runtimeSignalConfig?.endpoint,
            ),
            gateName:
              runtimeSignalConfig?.gateName?.trim() ||
              DEFAULT_RUNTIME_FALLBACK_GATE_NAME,
            gateSnapshotStore: gateSnapshotStorePromise,
            failureHoldMs: Math.max(
              1_000,
              runtimeSignalConfig?.failureHoldMs ??
                DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS,
            ),
            maxBodyBytes: Math.max(
              512,
              runtimeSignalConfig?.maxBodyBytes ??
                DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES,
            ),
            auth: normalizeRequiredRuntimeFallbackSignalAuthConfig(
              runtimeSignalConfig?.auth,
            ),
            trustPolicy: normalizeRuntimeFallbackTrustPolicy(
              runtimeSignalConfig?.trustPolicy,
            ),
            runtimeState: createRuntimeFallbackSignalRuntimeState(),
          };
        }
      }

      // The runtime status endpoint exposes detail only to authenticated
      // callers. Auth can be configured through runtimeFallbackSignal.auth
      // even when the signal endpoint itself stays disabled.
      runtimeStatusAuthConfig =
        runtimeFallbackSignalConfig?.auth ??
        normalizeRuntimeFallbackSignalAuthConfig(
          canaryConfig.autopilot?.runtimeFallbackSignal?.auth,
        );
    }

    if (runtimeFallbackSignalConfig) {
      const signalConfig = runtimeFallbackSignalConfig;
      middlewares.push({
        name: 'telemetry-runtime-fallback-signal',
        path: signalConfig.endpoint,
        method: 'post',
        order: 'pre',
        handler: async (c: Context<ServerEnv>) => {
          try {
            enforceRuntimeFallbackSignalAuth(c, signalConfig);
            const { payload } = await parseRuntimeFallbackSignalPayload(
              c,
              signalConfig.maxBodyBytes,
            );
            const trustResult = enforceRuntimeFallbackSignalTrustPolicy(
              payload,
              signalConfig,
              {
                remoteAddress: getRequestRemoteAddress(c),
              },
            );
            if (trustResult.deduped) {
              return c.json({ ok: true, deduped: true }, 202);
            }
            await persistRuntimeFallbackContractGate(payload, signalConfig);
            return c.json({ ok: true }, 202);
          } catch (error) {
            const signalError = error as RuntimeSignalError;
            const status = getRuntimeSignalErrorStatusCode(signalError);
            return c.json(
              {
                ok: false,
                error:
                  signalError instanceof Error
                    ? signalError.message
                    : String(signalError),
              },
              status,
            );
          }
        },
      });
    }

    middlewares.push({
      name: 'telemetry-runtime-status',
      path: DEFAULT_RUNTIME_STATUS_ENDPOINT,
      method: 'get',
      order: 'pre',
      handler: async (c: Context<ServerEnv>) => {
        try {
          // Telemetry/canary/trust internals are only disclosed to
          // authenticated callers. Without a configured auth token the
          // endpoint stays a bare health probe.
          if (!runtimeStatusAuthConfig?.enabled) {
            return c.json({
              ok: true,
              timestamp: Date.now(),
            });
          }

          enforceRuntimeFallbackSignalAuthToken(
            c.req.header(runtimeStatusAuthConfig.headerName),
            runtimeStatusAuthConfig,
          );

          return c.json({
            ok: true,
            timestamp: Date.now(),
            telemetry: {
              queueStats: registry.getQueueStats(),
              exporterHealth: registry.getExporterHealth(),
            },
            canary: canaryOrchestrator
              ? {
                  enabled: true,
                  ...canaryOrchestrator.getStatusSnapshot(),
                }
              : {
                  enabled: false,
                },
            runtimeFallbackSignal: runtimeFallbackSignalConfig
              ? {
                  enabled: true,
                  endpoint: runtimeFallbackSignalConfig.endpoint,
                  gateName: runtimeFallbackSignalConfig.gateName,
                  failureHoldMs: runtimeFallbackSignalConfig.failureHoldMs,
                  maxBodyBytes: runtimeFallbackSignalConfig.maxBodyBytes,
                  auth: {
                    enabled: runtimeFallbackSignalConfig.auth.enabled,
                    headerName: runtimeFallbackSignalConfig.auth.headerName,
                  },
                  trustPolicy: {
                    allowedApps:
                      runtimeFallbackSignalConfig.trustPolicy.allowedApps,
                    allowedEntryOrigins:
                      runtimeFallbackSignalConfig.trustPolicy
                        .allowedEntryOrigins,
                    enforceRuntimeDigest:
                      runtimeFallbackSignalConfig.trustPolicy
                        .enforceRuntimeDigest,
                    expectedRuntimeDigestsCount: Object.keys(
                      runtimeFallbackSignalConfig.trustPolicy
                        .expectedRuntimeDigests,
                    ).length,
                    maxSignalsPerWindow:
                      runtimeFallbackSignalConfig.trustPolicy
                        .maxSignalsPerWindow,
                    windowMs: runtimeFallbackSignalConfig.trustPolicy.windowMs,
                    dedupeWindowMs:
                      runtimeFallbackSignalConfig.trustPolicy.dedupeWindowMs,
                  },
                }
              : {
                  enabled: false,
                },
          });
        } catch (error) {
          const signalError = error as RuntimeSignalError;
          return c.json(
            {
              ok: false,
              error:
                signalError instanceof Error
                  ? signalError.message
                  : String(signalError),
            },
            getRuntimeSignalErrorStatusCode(signalError),
          );
        }
      },
    });

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

    let telemetryLaneClosed = false;
    const closeTelemetryLane = async () => {
      if (telemetryLaneClosed) {
        return;
      }
      telemetryLaneClosed = true;
      activeTelemetryLaneClosers.delete(closeTelemetryLane);
      contractGateAutopilot?.stop();
      canaryOrchestrator?.stop();
      await registry.shutdown();
    };

    let prepared = false;
    api.onPrepare(async () => {
      if (prepared) {
        return;
      }
      prepared = true;

      // Shutdown path for the telemetry lane: flush pending envelopes and
      // stop canary/autopilot pollers when the node server closes (this also
      // covers dev-server restarts, which close the previous node server
      // before assembling a new one) with process beforeExit as the
      // final-flush floor when no node server handle exists.
      const { nodeServer } = api.getServerContext() as {
        nodeServer?: {
          once?: (event: string, listener: () => void) => unknown;
        };
      };
      if (nodeServer && typeof nodeServer.once === 'function') {
        nodeServer.once('close', () => {
          void closeTelemetryLane();
        });
      }
      activeTelemetryLaneClosers.add(closeTelemetryLane);
      ensureTelemetryBeforeExitHook();

      if (telemetryConfig.exporters?.otlp?.enabled) {
        maybeWarnLegacyOtlpEndpoint(telemetryConfig.exporters.otlp.endpoint);
        await registry.register(
          createOtlpTelemetryExporter(telemetryConfig.exporters.otlp),
        );
      }

      if (telemetryConfig.exporters?.victoriaMetrics?.enabled) {
        await registry.register(
          createVictoriaMetricsTelemetryExporter(
            telemetryConfig.exporters.victoriaMetrics,
          ),
        );
      }

      await registry.startupHealthCheck({
        failLoud: telemetryConfig.failLoudStartup ?? true,
      });

      if (!canaryOrchestrator) {
        return;
      }

      canaryOrchestrator.start();
      if (gateSnapshotStorePromise) {
        const gateSnapshotStore = await gateSnapshotStorePromise;
        contractGateAutopilot = new ContractGateAutopilot({
          orchestrator: canaryOrchestrator,
          gateSnapshotPath: resolveContractGateSnapshotPath(
            appDirectory,
            canaryConfig?.autopilot?.gateSnapshotPath,
          ),
          gateSnapshotStore,
          pollIntervalMs: canaryConfig?.autopilot?.pollIntervalMs,
          gateStaleAfterMs: canaryConfig?.autopilot?.gateStaleAfterMs,
        });
      }
      if (contractGateAutopilot) {
        await contractGateAutopilot.start();
      }
      canaryOrchestrator.evaluate();
    });
  },
});
