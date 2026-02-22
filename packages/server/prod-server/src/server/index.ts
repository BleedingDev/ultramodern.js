import { IncomingMessage, ServerResponse, Server as httpServer } from 'http';

import type { ListenOptions } from 'net';
import path from 'path';
import {
  fs,
  createLogger,
  SHARED_DIR,
  OUTPUT_CONFIG_FILE,
  dotenv,
  dotenvExpand,
  INTERNAL_SERVER_PLUGINS,
  ensureAbsolutePath,
} from '@modern-js/utils';
import {
  serverManager,
  AppContext,
  ConfigContext,
  loadPlugins,
  ServerConfig,
} from '@modern-js/server-core';
import { ISAppContext } from '@modern-js/types';
import {
  ModernServerOptions,
  ServerHookRunner,
  ServerConstructor,
  ModernServerInterface,
} from '../type';
import { metrics as defaultMetrics } from '../libs/metrics';
import {
  TelemetryCanaryDecision,
  TelemetryCanaryOrchestrator,
  TelemetryRegistry,
  createOtlpTelemetryExporter,
  createTelemetryAwareMetrics,
  createVictoriaMetricsTelemetryExporter,
  hasEnabledTelemetryExporters,
} from '../libs/telemetry';
import {
  loadConfig,
  getServerConfigPath,
  requireConfig,
} from '../libs/loadConfig';
import { debug } from '../utils';
import { createProdServer } from './modernServerSplit';

export class Server {
  public options: ModernServerOptions;

  protected serverImpl: ServerConstructor = createProdServer;

  private server!: ModernServerInterface;

  private app!: httpServer;

  private runner!: ServerHookRunner;

  private serverConfig: ServerConfig;

  private telemetryRegistry?: TelemetryRegistry;

  private canaryOrchestrator?: TelemetryCanaryOrchestrator;

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

    if (!hasEnabledExporters) {
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
        queueDroppedWarnThreshold: telemetryConfig.slo?.queueDroppedWarnThreshold,
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
      const contractGates =
        canaryConfig.contractGates as
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
      orchestrator.evaluate();
    }
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
    return (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
      const requestHandler = this.server.getRequestHandler();
      return requestHandler(req, res, next);
    };
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
