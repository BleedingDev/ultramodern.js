import type { SSRMode } from '@modern-js/types';
import type { WatchOptions } from '@modern-js/utils';
import type { ServerTelemetryUserConfig } from './serverTelemetry';

export type {
  ServerTelemetryCanaryAutopilotStateStoreUserConfig,
  ServerTelemetryCanaryAutopilotUserConfig,
  ServerTelemetryCanaryContractGateUserConfig,
  ServerTelemetryCanaryRuntimeFallbackSignalAuthUserConfig,
  ServerTelemetryCanaryRuntimeFallbackSignalTrustPolicyUserConfig,
  ServerTelemetryCanaryRuntimeFallbackSignalUserConfig,
  ServerTelemetryCanaryUserConfig,
  ServerTelemetryExporterOptions,
  ServerTelemetrySloUserConfig,
  ServerTelemetryUserConfig,
  ServerTelemetryVictoriaMetricsOptions,
} from './serverTelemetry';

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
      loaderFailureMode?: 'clientRender' | 'errorBoundary';
      /**
       * Enable app-level Module Federation SSR bridge path.
       * This flag should be enabled in both host and remote applications.
       * @default false
       */
      moduleFederationAppSSR?: boolean;
    };

export type SSRByEntries = Record<string, SSR>;

type SSRPreload = Record<string, unknown>;

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
