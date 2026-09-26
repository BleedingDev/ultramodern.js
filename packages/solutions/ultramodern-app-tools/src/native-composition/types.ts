import type { AppUserConfig as NativeAppUserConfig } from '@modern-js/app-tools';
import type { PrecompressConfig } from '@modern-js/app-tools-extensions/build-config/precompress/plugin';
import type {
  CloudflareDeployConfig,
  NodeDeployConfig,
} from '@modern-js/app-tools-extensions/config';
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
