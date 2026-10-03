import type {
  AppTools,
  AppUserConfig as NativeAppUserConfig,
} from '@modern-js/app-tools/cli-config';
import type { PrecompressConfig } from '@modern-js/app-tools-extensions/build-config/precompress/plugin';
import type { CloudflareDeployConfig } from '@modern-js/app-tools-extensions/config';
import type { Renderer } from '@modern-js/renderer-core';
import type {
  BffRuntimeUserConfig,
  ServerTelemetryUserConfig,
} from '@modern-js/runtime-extensions/server-config';

type NativeServerConfig = NonNullable<NativeAppUserConfig['server']>;
type NativeSSRConfig = Exclude<NativeServerConfig['ssr'], boolean | undefined>;

/** Native Modern.js configuration with the fork's explicitly owned options. */
export type UltramodernAppUserConfig = Omit<
  NativeAppUserConfig,
  'output' | 'server' | 'bff' | 'deploy'
> & {
  /** Select the native application renderer before plugins are registered. */
  renderer?: Renderer;
  output?: Omit<NonNullable<NativeAppUserConfig['output']>, 'precompress'> & {
    precompress?: boolean | PrecompressConfig;
  };
  server?: Omit<NativeServerConfig, 'ssr' | 'telemetry'> & {
    ssr?: boolean | (NativeSSRConfig & { moduleFederationAppSSR?: boolean });
    telemetry?: ServerTelemetryUserConfig;
  };
  bff?: Omit<
    NonNullable<NativeAppUserConfig['bff']>,
    keyof BffRuntimeUserConfig
  > &
    BffRuntimeUserConfig & { requestId?: string };
  deploy?: NonNullable<NativeAppUserConfig['deploy']> &
    CloudflareDeployConfig &
    NodeDeployConfig;
};

export type AppUserConfig = UltramodernAppUserConfig;

/** The owning loader accepts fork config while retaining upstream entry hooks. */
export type UltramodernConfigLoader = Omit<AppTools, 'config'> & {
  config: UltramodernAppUserConfig;
};
