import type {
  CloudflareWorkerDeployConfig,
  DeployTarget,
} from '@modern-js/app-tools-extensions/config';

export type {
  CloudflareWorkerArtifactConfig,
  CloudflareWorkerD1DatabaseConfig,
  CloudflareWorkerPublicAssetConfig,
  CloudflareWorkerSecurityConfig,
  CloudflareWorkerSecurityCorsConfig,
  CloudflareWorkerSecurityCspConfig,
  CloudflareWorkerSecurityCspMode,
  CloudflareWorkerSecurityNoindexConfig,
  CloudflareWorkerServiceBindingConfig,
  CloudflareWorkerServiceBindingFragmentConfig,
  DeployTarget,
  JsonValue,
} from '@modern-js/app-tools-extensions/config';

export interface MicroFrontend {
  /**
   * Specifies whether to enable the HTML entry.
   * When set to `true`, the current child application will be externalized for `react` and `react-dom`.
   * @default true
   */
  enableHtmlEntry?: boolean;
  /**
   * Specifies whether to use the external base library.
   * @default false
   */
  externalBasicLibrary?: boolean;
  moduleApp?: string;
}

export interface DeployUserConfig {
  /**
   * Selects the deploy output preset.
   * `MODERNJS_DEPLOY` still overrides provider auto-detection when set.
   * @default node
   */
  target?: DeployTarget;
  /**
   * Used to configure micro-frontend sub-application information.
   * @default false
   */
  microFrontend?: boolean | MicroFrontend;
  worker?: CloudflareWorkerDeployConfig;
}
