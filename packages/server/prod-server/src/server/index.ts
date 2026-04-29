import {
  AppContext,
  ConfigContext,
  loadPlugins,
  type ServerConfig,
  serverManager,
} from '@modern-js/server-core';
import type { ISAppContext } from '@modern-js/types';
import {
  createLogger,
  dotenv,
  dotenvExpand,
  ensureAbsolutePath,
  fs,
  INTERNAL_SERVER_PLUGINS,
  OUTPUT_CONFIG_FILE,
  SHARED_DIR,
} from '@modern-js/utils';
import { promises as nodeFs } from 'fs';
import type {
  Server as httpServer,
  IncomingMessage,
  ServerResponse,
} from 'http';
import type { ListenOptions } from 'net';
import path from 'path';
import { ContractGateAutopilot } from '../libs/contractGateAutopilot';
import {
  getServerConfigPath,
  loadConfig,
  requireConfig,
} from '../libs/loadConfig';
import { metrics as defaultMetrics } from '../libs/metrics';
import {
  DEFAULT_RUNTIME_FALLBACK_WORKER_TIMEOUT_MS,
  persistRuntimeFallbackContractGateInWorker,
} from '../libs/runtimeFallbackWorkerLane';
import {
  createOtlpTelemetryExporter,
  createRuntimeFallbackSignalRuntimeState,
  createTelemetryAwareMetrics,
  createVictoriaMetricsTelemetryExporter,
  DEFAULT_RUNTIME_STATUS_ENDPOINT,
  enforceRuntimeFallbackSignalAuthToken,
  enforceRuntimeFallbackSignalTrustPolicy,
  getRuntimeSignalErrorStatusCode,
  hasEnabledTelemetryExporters,
  normalizeRuntimeFallbackSignalAuthConfig,
  normalizeRuntimeFallbackTrustPolicy,
  parseRuntimeFallbackSignalPayloadFromRawBody,
  type RuntimeFallbackSignalAuthConfig,
  type RuntimeFallbackSignalRuntimeState,
  type RuntimeFallbackSignalTrustPolicy,
  type RuntimeSignalError,
  resolveRuntimeFallbackSignalEndpoint,
  type TelemetryCanaryDecision,
  TelemetryCanaryOrchestrator,
  type TelemetryCanaryStatusSnapshot,
  TelemetryRegistry,
} from '../libs/telemetry';
import type {
  ModernServerInterface,
  ModernServerOptions,
  ServerConstructor,
  ServerHookRunner,
} from '../type';
import { debug } from '../utils';
import { createProdServer } from './modernServerSplit';

const CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_RUNTIME_FALLBACK_GATE_NAME = 'runtime-mf-fallback-health';
const DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS = 5 * 60_000;
const DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES = 16 * 1024;

type RuntimeFallbackSignalWorkerLaneConfig = {
  enabled: boolean;
  timeoutMs: number;
  workerSuccessCount: number;
  fallbackToMainThreadCount: number;
  lastError?: string;
};

type RuntimeFallbackSignalConfig = {
  endpoint: string;
  gateName: string;
  gateSnapshotPath: string;
  failureHoldMs: number;
  maxBodyBytes: number;
  auth: RuntimeFallbackSignalAuthConfig;
  trustPolicy: RuntimeFallbackSignalTrustPolicy;
  runtimeState: RuntimeFallbackSignalRuntimeState;
  workerLane: RuntimeFallbackSignalWorkerLaneConfig;
};

type ContractGateSnapshotFile = {
  schemaVersion?: number;
  updatedAt?: number;
  gates?: Record<string, unknown>;
};

export class Server {
  public options: ModernServerOptions;

  protected serverImpl: ServerConstructor = createProdServer;

  private server!: ModernServerInterface;

  private app!: httpServer;

  private runner!: ServerHookRunner;

  private serverConfig: ServerConfig;

  private telemetryRegistry?: TelemetryRegistry;

  private canaryOrchestrator?: TelemetryCanaryOrchestrator;

  private contractGateAutopilot?: ContractGateAutopilot;

  private runtimeFallbackSignalConfig?: RuntimeFallbackSignalConfig;

  private runtimeStatusEndpoint: string = DEFAULT_RUNTIME_STATUS_ENDPOINT;

  constructor(options: ModernServerOptions) {
    options.logger = options.logger || createLogger({ level: 'warn' });
    options.metrics = options.metrics || defaultMetrics;

    this.options = options;
    this.serverConfig = {};
  }

  /**
   * 初始化顺序
   * - 读取 .env.{process.env.MODERN_ENV} 文件，加载环境变量
   * - 获取 server runtime config
   * - 设置 context
   * - 创建 hooksRunner
   * - 合并插件，内置插件和 serverConfig 中配置的插件
   * - 执行 config hook
   * - 获取最终的配置
   * - 设置配置到 context
   * - 初始化 server
   * - 执行 prepare hook
   * - 执行 server init
   */
  public async init(
    { disableHttpServer = false }: { disableHttpServer: boolean } = {
      disableHttpServer: false,
    },
  ) {
    const { options } = this;

    await this.loadServerEnv(options);

    this.initServerConfig(options);

    await this.injectContext(this.runner, options);

    // initialize server runner
    this.runner = await this.createHookRunner();

    // init config and execute config hook
    await this.initConfig(this.runner, options);
    await this.initTelemetry(options);

    await this.injectContext(this.runner, options);

    // initialize server
    this.server = this.serverImpl(options);

    await this.runPrepareHook(this.runner);

    // create http-server
    if (!disableHttpServer) {
      this.app = await this.server.createHTTPServer(this.getRequestHandler());
    }

    // runner can only be used after server init
    {
      const result = await this.runner.beforeServerInit({
        app: this.app,
        server: this.server,
      });
      ({ app: this.app = this.app, server: this.server } = result);
    }
    await this.server.onInit(this.runner, this.app);
    {
      const result = await this.runner.afterServerInit({
        app: this.app,
        server: this.server,
      });
      ({ app: this.app = this.app, server: this.server } = result);
    }

    return this;
  }

  /**
   * Execute config hooks
   * @param runner
   * @param options
   */
  private runConfigHook(runner: ServerHookRunner, serverConfig: ServerConfig) {
    const newServerConfig = runner.config(serverConfig || {});
    return newServerConfig;
  }

  private async runPrepareHook(runner: ServerHookRunner) {
    runner.prepare();
  }

  private initServerConfig(options: ModernServerOptions) {
    const { pwd, serverConfigFile } = options;
    const distDirectory = path.join(pwd, options.config.output.path || 'dist');
    const serverConfigPath = getServerConfigPath(
      distDirectory,
      serverConfigFile,
    );
    const serverConfig = requireConfig(serverConfigPath);
    this.serverConfig = serverConfig;
  }

  /**
   *
   * merge cliConfig and serverConfig
   */
  private async initConfig(
    runner: ServerHookRunner,
    options: ModernServerOptions,
  ) {
    const { pwd, config } = options;

    const { serverConfig } = this;

    const finalServerConfig = this.runConfigHook(runner, serverConfig);

    const resolvedConfigPath = ensureAbsolutePath(
      pwd,
      path.join(config.output.path || 'dist', OUTPUT_CONFIG_FILE),
    );

    options.config = loadConfig({
      cliConfig: config,
      serverConfig: finalServerConfig,
      resolvedConfigPath,
    });
  }

  private async initTelemetry(options: ModernServerOptions) {
    const telemetryConfig = options.config.server?.telemetry;
    if (!telemetryConfig) {
      return;
    }

    const hasEnabledExporters = hasEnabledTelemetryExporters(telemetryConfig);
    if (telemetryConfig.enabled !== true && !hasEnabledExporters) {
      return;
    }

    const registry = new TelemetryRegistry({
      service:
        telemetryConfig.service || options.appContext?.metaName || 'modern-js',
      module: telemetryConfig.module || 'server',
      environment:
        telemetryConfig.environment ||
        process.env.MODERN_ENV ||
        process.env.NODE_ENV ||
        'development',
      samplingRate: telemetryConfig.samplingRate,
      flushIntervalMs: telemetryConfig.flushIntervalMs,
      maxBatchSize: telemetryConfig.maxBatchSize,
      maxQueueSize: telemetryConfig.maxQueueSize,
      redactionKeys: telemetryConfig.redactionKeys,
      slo: {
        queueUtilizationWarnThreshold:
          telemetryConfig.slo?.queueUtilizationWarnThreshold,
        queueDroppedWarnThreshold:
          telemetryConfig.slo?.queueDroppedWarnThreshold,
        alertCooldownMs: telemetryConfig.slo?.alertCooldownMs,
        onAlert: alert => {
          options.logger?.warn(
            `[telemetry.slo] ${alert.type} threshold=${alert.threshold} value=${alert.value} depth=${alert.queueDepth}/${alert.queueCapacity} dropped=${alert.totalDropped}`,
          );
        },
      },
    });

    if (telemetryConfig.exporters?.otlp?.enabled) {
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

    try {
      await registry.startupHealthCheck({
        failLoud: telemetryConfig.failLoudStartup ?? true,
      });
    } catch (error) {
      await registry.shutdown();
      throw error;
    }

    options.metrics = createTelemetryAwareMetrics(
      options.metrics || defaultMetrics,
      registry,
    );
    this.telemetryRegistry = registry;

    const canaryConfig = telemetryConfig.canary;
    if (canaryConfig?.enabled) {
      const contractGates = canaryConfig.contractGates as
        | Record<string, boolean | { passed: boolean; reason?: string }>
        | undefined;
      const orchestrator = new TelemetryCanaryOrchestrator({
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
          options.logger?.info(
            `[telemetry.canary] promoted after ${decision.consecutiveHealthy} healthy evaluations`,
          );
          this.emitCanaryDecisionMetric(registry, decision, 'promote');
        },
        onRollback: decision => {
          options.logger?.error(
            `[telemetry.canary] rollback triggered failures=${decision.failures.map(item => item.reason).join(',')}`,
          );
          this.emitCanaryDecisionMetric(registry, decision, 'rollback');
        },
      });
      if (contractGates) {
        orchestrator.setContractGates(contractGates);
      }
      this.canaryOrchestrator = orchestrator;
      orchestrator.start();

      const autopilotEnabled = canaryConfig.autopilot?.enabled ?? true;
      if (autopilotEnabled) {
        const gateSnapshotPath = this.resolveContractGateSnapshotPath(
          options,
          canaryConfig.autopilot?.gateSnapshotPath,
        );
        this.contractGateAutopilot = new ContractGateAutopilot({
          orchestrator,
          gateSnapshotPath,
          pollIntervalMs: canaryConfig.autopilot?.pollIntervalMs,
          gateStaleAfterMs: canaryConfig.autopilot?.gateStaleAfterMs,
          logger: {
            info: message => {
              options.logger?.info(message);
            },
            warn: message => {
              options.logger?.warn(message);
            },
          },
        });
        await this.contractGateAutopilot.start();

        const runtimeSignalConfig =
          canaryConfig.autopilot?.runtimeFallbackSignal;
        const runtimeSignalEnabled = runtimeSignalConfig?.enabled ?? true;
        if (runtimeSignalEnabled) {
          const workerLaneConfig = runtimeSignalConfig?.workerLane;
          const workerLaneEnabledFromEnv =
            process.env.MODERN_RUNTIME_FALLBACK_WORKER_LANE === 'true';
          const workerLaneEnabled =
            typeof workerLaneConfig?.enabled === 'boolean'
              ? workerLaneConfig.enabled
              : workerLaneEnabledFromEnv;
          this.runtimeFallbackSignalConfig = {
            endpoint: resolveRuntimeFallbackSignalEndpoint(
              runtimeSignalConfig?.endpoint,
            ),
            gateName:
              runtimeSignalConfig?.gateName?.trim() ||
              DEFAULT_RUNTIME_FALLBACK_GATE_NAME,
            gateSnapshotPath,
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
            auth: normalizeRuntimeFallbackSignalAuthConfig(
              runtimeSignalConfig?.auth,
            ),
            trustPolicy: normalizeRuntimeFallbackTrustPolicy(
              runtimeSignalConfig?.trustPolicy,
            ),
            runtimeState: createRuntimeFallbackSignalRuntimeState(),
            workerLane: {
              enabled: workerLaneEnabled,
              timeoutMs: Math.max(
                25,
                workerLaneConfig?.timeoutMs ??
                  DEFAULT_RUNTIME_FALLBACK_WORKER_TIMEOUT_MS,
              ),
              workerSuccessCount: 0,
              fallbackToMainThreadCount: 0,
            },
          };
        }
      }

      orchestrator.evaluate();
    }
  }

  private resolveContractGateSnapshotPath(
    options: ModernServerOptions,
    configuredPath: string | undefined,
  ) {
    const rawPath =
      configuredPath ||
      process.env.MODERN_CONTRACT_GATES_FILE ||
      '.modern/contract-gates.json';
    if (path.isAbsolute(rawPath)) {
      return rawPath;
    }
    return path.resolve(options.pwd, rawPath);
  }

  private emitCanaryDecisionMetric(
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
      // Canary decision metrics are best-effort and must not break server startup.
    }
  }

  public async close() {
    if (this.contractGateAutopilot) {
      this.contractGateAutopilot.stop();
      this.contractGateAutopilot = undefined;
    }
    this.runtimeFallbackSignalConfig = undefined;
    if (this.canaryOrchestrator) {
      this.canaryOrchestrator.stop();
    }
    if (this.telemetryRegistry) {
      await this.telemetryRegistry.shutdown();
    }
    if (!this.app) {
      return;
    }
    await new Promise<void>(resolve => {
      this.app.close(() => resolve());
    });
  }

  public listen<T extends number | ListenOptions | undefined>(
    options: T,
    listener: any,
  ) {
    const callback = () => {
      listener?.();
    };

    if (typeof options === 'object') {
      if (process.env.PORT) {
        Object.assign(options, { port: process.env.PORT });
      }
      this.app.listen(options, callback);
    } else {
      this.app.listen(process.env.PORT || options || 8080, callback);
    }
  }

  public getRequestHandler() {
    const requestHandler = this.server.getRequestHandler();
    return (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
      if (this.shouldHandleRuntimeStatus(req)) {
        void this.handleRuntimeStatus(req, res);
        return;
      }
      if (this.shouldHandleRuntimeFallbackSignal(req)) {
        void this.handleRuntimeFallbackSignal(req, res);
        return;
      }
      return requestHandler(req, res, next);
    };
  }

  private shouldHandleRuntimeFallbackSignal(req: IncomingMessage) {
    const runtimeSignalConfig = this.runtimeFallbackSignalConfig;
    if (!runtimeSignalConfig) {
      return false;
    }
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      return false;
    }
    const pathName = this.getRequestPath(req.url);
    return pathName === runtimeSignalConfig.endpoint;
  }

  private shouldHandleRuntimeStatus(req: IncomingMessage) {
    if ((req.method || 'GET').toUpperCase() !== 'GET') {
      return false;
    }
    const pathName = this.getRequestPath(req.url);
    return pathName === this.runtimeStatusEndpoint;
  }

  private getRequestPath(urlValue: string | undefined) {
    try {
      const requestUrl = new URL(urlValue || '/', 'http://127.0.0.1');
      return requestUrl.pathname;
    } catch (_error) {
      return '/';
    }
  }

  private async readRequestBody(req: IncomingMessage, maxBodyBytes: number) {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let done = false;

      const cleanup = () => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
      };

      const onData = (chunk: Buffer | string) => {
        if (done) {
          return;
        }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBodyBytes) {
          const error = new Error('runtime fallback signal payload too large');
          (error as Error & { code?: string }).code = 'PAYLOAD_TOO_LARGE';
          done = true;
          cleanup();
          reject(error);
          return;
        }
        chunks.push(buffer);
      };

      const onEnd = () => {
        if (done) {
          return;
        }
        done = true;
        cleanup();
        resolve(Buffer.concat(chunks).toString('utf8'));
      };

      const onError = (error: Error) => {
        if (done) {
          return;
        }
        done = true;
        cleanup();
        reject(error);
      };

      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
    });
  }

  private async handleRuntimeFallbackSignal(
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const runtimeSignalConfig = this.runtimeFallbackSignalConfig;
    if (!runtimeSignalConfig) {
      res.statusCode = 404;
      res.end();
      return;
    }

    try {
      enforceRuntimeFallbackSignalAuthToken(
        this.getRequestHeader(req, runtimeSignalConfig.auth.headerName),
        runtimeSignalConfig.auth,
      );
      const rawBody = await this.readRequestBody(
        req,
        runtimeSignalConfig.maxBodyBytes,
      );
      const payload = parseRuntimeFallbackSignalPayloadFromRawBody(
        rawBody,
        runtimeSignalConfig.maxBodyBytes,
      );
      const trustResult = enforceRuntimeFallbackSignalTrustPolicy(payload, {
        trustPolicy: runtimeSignalConfig.trustPolicy,
        runtimeState: runtimeSignalConfig.runtimeState,
      });
      if (trustResult.deduped) {
        res.statusCode = 202;
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true,"deduped":true}');
        return;
      }

      let persistedByWorkerLane = false;
      if (runtimeSignalConfig.workerLane.enabled) {
        const workerResult = await persistRuntimeFallbackContractGateInWorker(
          {
            snapshotPath: runtimeSignalConfig.gateSnapshotPath,
            gateName: runtimeSignalConfig.gateName,
            failureHoldMs: runtimeSignalConfig.failureHoldMs,
            payload: payload as Record<string, unknown>,
            schemaVersion: CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
          },
          {
            enabled: true,
            timeoutMs: runtimeSignalConfig.workerLane.timeoutMs,
          },
        );
        if (workerResult.ok) {
          persistedByWorkerLane = true;
          runtimeSignalConfig.workerLane.workerSuccessCount += 1;
          runtimeSignalConfig.workerLane.lastError = undefined;
          const payloadRecord = payload as Record<string, unknown>;
          const reason =
            typeof payloadRecord.reason === 'string'
              ? payloadRecord.reason
              : 'runtime_fallback';
          const phase =
            typeof payloadRecord.phase === 'string'
              ? payloadRecord.phase
              : 'unknown';
          const appName =
            typeof payloadRecord.appName === 'string'
              ? payloadRecord.appName
              : 'unknown';
          this.options.logger?.warn(
            `[telemetry.canary.autopilot] runtime fallback signal gate=${runtimeSignalConfig.gateName} reason=${reason} phase=${phase} app=${appName} workerLane=true`,
          );
        } else {
          runtimeSignalConfig.workerLane.fallbackToMainThreadCount += 1;
          runtimeSignalConfig.workerLane.lastError = workerResult.error;
          this.options.logger?.warn(
            `[telemetry.canary.autopilot] runtime fallback worker lane fallback: ${workerResult.error || 'unknown_error'}`,
          );
        }
      }

      if (!persistedByWorkerLane) {
        await this.persistRuntimeFallbackContractGate(
          payload as Record<string, unknown>,
          runtimeSignalConfig,
        );
      }

      res.statusCode = 202;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    } catch (error) {
      const signalError = error as RuntimeSignalError;
      res.statusCode = getRuntimeSignalErrorStatusCode(signalError);
      res.setHeader('content-type', 'application/json');
      res.end(
        `{"ok":false,"error":${JSON.stringify(
          signalError instanceof Error
            ? signalError.message
            : String(signalError),
        )}}`,
      );
      this.options.logger?.warn(
        `[telemetry.canary.autopilot] runtime fallback signal rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleRuntimeStatus(req: IncomingMessage, res: ServerResponse) {
    try {
      if (this.runtimeFallbackSignalConfig?.auth.enabled) {
        enforceRuntimeFallbackSignalAuthToken(
          this.getRequestHeader(
            req,
            this.runtimeFallbackSignalConfig.auth.headerName,
          ),
          this.runtimeFallbackSignalConfig.auth,
        );
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(this.buildRuntimeStatusPayload()));
    } catch (error) {
      const signalError = error as RuntimeSignalError;
      res.statusCode = getRuntimeSignalErrorStatusCode(signalError);
      res.setHeader('content-type', 'application/json');
      res.end(
        `{"ok":false,"error":${JSON.stringify(
          signalError instanceof Error
            ? signalError.message
            : String(signalError),
        )}}`,
      );
    }
  }

  private buildRuntimeStatusPayload(): {
    ok: boolean;
    timestamp: number;
    telemetry: {
      enabled: boolean;
      queueStats: ReturnType<TelemetryRegistry['getQueueStats']> | null;
      exporterHealth: ReturnType<TelemetryRegistry['getExporterHealth']>;
    };
    canary:
      | { enabled: false }
      | ({ enabled: true } & TelemetryCanaryStatusSnapshot);
    runtimeFallbackSignal:
      | {
          enabled: false;
        }
      | {
          enabled: true;
          endpoint: string;
          gateName: string;
          failureHoldMs: number;
          maxBodyBytes: number;
          auth: {
            enabled: boolean;
            headerName: string;
          };
          trustPolicy: {
            allowedApps: string[];
            allowedEntryOrigins: string[];
            enforceRuntimeDigest: boolean;
            expectedRuntimeDigestsCount: number;
            maxSignalsPerWindow: number;
            windowMs: number;
            dedupeWindowMs: number;
          };
          workerLane: {
            enabled: boolean;
            timeoutMs: number;
            workerSuccessCount: number;
            fallbackToMainThreadCount: number;
            lastError?: string;
          };
        };
  } {
    const telemetry = this.telemetryRegistry
      ? {
          enabled: true,
          queueStats: this.telemetryRegistry.getQueueStats(),
          exporterHealth: this.telemetryRegistry.getExporterHealth(),
        }
      : {
          enabled: false,
          queueStats: null,
          exporterHealth: [],
        };
    const canary = this.canaryOrchestrator
      ? {
          enabled: true as const,
          ...this.canaryOrchestrator.getStatusSnapshot(),
        }
      : {
          enabled: false as const,
        };
    const runtimeFallbackSignal = this.runtimeFallbackSignalConfig
      ? {
          enabled: true as const,
          endpoint: this.runtimeFallbackSignalConfig.endpoint,
          gateName: this.runtimeFallbackSignalConfig.gateName,
          failureHoldMs: this.runtimeFallbackSignalConfig.failureHoldMs,
          maxBodyBytes: this.runtimeFallbackSignalConfig.maxBodyBytes,
          auth: {
            enabled: this.runtimeFallbackSignalConfig.auth.enabled,
            headerName: this.runtimeFallbackSignalConfig.auth.headerName,
          },
          trustPolicy: {
            allowedApps:
              this.runtimeFallbackSignalConfig.trustPolicy.allowedApps,
            allowedEntryOrigins:
              this.runtimeFallbackSignalConfig.trustPolicy.allowedEntryOrigins,
            enforceRuntimeDigest:
              this.runtimeFallbackSignalConfig.trustPolicy.enforceRuntimeDigest,
            expectedRuntimeDigestsCount: Object.keys(
              this.runtimeFallbackSignalConfig.trustPolicy
                .expectedRuntimeDigests,
            ).length,
            maxSignalsPerWindow:
              this.runtimeFallbackSignalConfig.trustPolicy.maxSignalsPerWindow,
            windowMs: this.runtimeFallbackSignalConfig.trustPolicy.windowMs,
            dedupeWindowMs:
              this.runtimeFallbackSignalConfig.trustPolicy.dedupeWindowMs,
          },
          workerLane: {
            enabled: this.runtimeFallbackSignalConfig.workerLane.enabled,
            timeoutMs: this.runtimeFallbackSignalConfig.workerLane.timeoutMs,
            workerSuccessCount:
              this.runtimeFallbackSignalConfig.workerLane.workerSuccessCount,
            fallbackToMainThreadCount:
              this.runtimeFallbackSignalConfig.workerLane
                .fallbackToMainThreadCount,
            lastError: this.runtimeFallbackSignalConfig.workerLane.lastError,
          },
        }
      : {
          enabled: false as const,
        };
    return {
      ok: true,
      timestamp: Date.now(),
      telemetry,
      canary,
      runtimeFallbackSignal,
    };
  }

  private getRequestHeader(req: IncomingMessage, headerName: string) {
    const raw = req.headers[headerName.toLowerCase()];
    if (Array.isArray(raw)) {
      return raw[0];
    }
    if (typeof raw === 'string') {
      return raw;
    }
    return undefined;
  }

  private async persistRuntimeFallbackContractGate(
    payload: Record<string, unknown>,
    runtimeSignalConfig: RuntimeFallbackSignalConfig,
  ) {
    const now = Date.now();
    const snapshotPath = runtimeSignalConfig.gateSnapshotPath;

    let snapshot: ContractGateSnapshotFile = {
      schemaVersion: CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
      updatedAt: now,
      gates: {},
    };
    if (await fs.pathExists(snapshotPath)) {
      try {
        const raw = await nodeFs.readFile(snapshotPath, 'utf8');
        const parsed = JSON.parse(raw) as ContractGateSnapshotFile;
        if (parsed && typeof parsed === 'object') {
          snapshot = {
            schemaVersion:
              typeof parsed.schemaVersion === 'number'
                ? parsed.schemaVersion
                : CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
            updatedAt:
              typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
            gates:
              parsed.gates && typeof parsed.gates === 'object'
                ? parsed.gates
                : {},
          };
        }
      } catch (_error) {
        snapshot = {
          schemaVersion: CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
          updatedAt: now,
          gates: {},
        };
      }
    }

    const reason =
      typeof payload.reason === 'string' ? payload.reason : 'runtime_fallback';
    const phase = typeof payload.phase === 'string' ? payload.phase : 'unknown';
    const appName =
      typeof payload.appName === 'string' ? payload.appName : 'unknown';
    const entry = typeof payload.entry === 'string' ? payload.entry : undefined;

    snapshot.schemaVersion = CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION;
    snapshot.updatedAt = now;
    snapshot.gates = snapshot.gates || {};
    snapshot.gates[runtimeSignalConfig.gateName] = {
      passed: false,
      reason: `runtime_fallback:${reason} phase=${phase} app=${appName}${entry ? ` entry=${entry}` : ''}`,
      updatedAt: now,
      expiresAt: now + runtimeSignalConfig.failureHoldMs,
      source: 'runtime-mf-fallback-signal',
      metadata: payload,
    };

    await nodeFs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await nodeFs.writeFile(
      snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );

    this.options.logger?.warn(
      `[telemetry.canary.autopilot] runtime fallback signal gate=${runtimeSignalConfig.gateName} reason=${reason} phase=${phase} app=${appName}`,
    );
  }

  public async render(req: IncomingMessage, res: ServerResponse, url?: string) {
    return this.server.render(req, res, url);
  }

  private async createHookRunner() {
    // clear server manager every create time
    serverManager.clear();

    const { options } = this;
    // TODO: 确认下这里是不是可以不从 options 中取插件，而是从 config 中取和过滤
    const {
      internalPlugins = INTERNAL_SERVER_PLUGINS,
      pwd,
      plugins = [],
    } = options;
    const serverPlugins = this.serverConfig.plugins || [];

    // server app context for serve plugin
    const loadedPlugins = loadPlugins(pwd, [...serverPlugins, ...plugins], {
      internalPlugins,
    });

    debug('plugins', loadedPlugins);
    loadedPlugins.forEach(p => {
      serverManager.usePlugin(p);
    });

    // create runner
    const hooksRunner = await serverManager.init();

    return hooksRunner;
  }

  private async injectContext(
    runner: ServerHookRunner,
    options: ModernServerOptions,
  ) {
    const appContext = this.initAppContext();
    const { config, pwd } = options;

    ConfigContext.set(config);
    AppContext.set({
      ...appContext,
      distDirectory: path.join(pwd, config.output.path || 'dist'),
    });
  }

  private initAppContext(): ISAppContext {
    const { options } = this;
    const { pwd: appDirectory, plugins = [], config, appContext } = options;
    const serverPlugins = plugins.map(p => ({
      server: p,
    }));

    return {
      appDirectory,
      apiDirectory: appContext?.apiDirectory,
      lambdaDirectory: appContext?.lambdaDirectory,
      sharedDirectory:
        appContext?.sharedDirectory || path.resolve(appDirectory, SHARED_DIR),
      distDirectory: path.join(appDirectory, config.output.path || 'dist'),
      plugins: serverPlugins,
    };
  }

  private async loadServerEnv(options: ModernServerOptions) {
    const { pwd: appDirectory } = options;
    const serverEnv = process.env.MODERN_ENV;
    const defaultEnvPath = path.resolve(appDirectory, `.env`);
    const serverEnvPath = path.resolve(appDirectory, `.env.${serverEnv}`);
    for (const envPath of [serverEnvPath, defaultEnvPath]) {
      if (
        (await fs.pathExists(envPath)) &&
        !(await fs.stat(envPath)).isDirectory()
      ) {
        const envConfig = dotenv.config({ path: envPath });
        dotenvExpand(envConfig);
      }
    }
  }
}
