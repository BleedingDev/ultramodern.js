import type {
  CloudflareWorkerSecurityConfig,
  DeployTarget,
} from './cloudflareDeploy';

export type {
  CloudflareWorkerSecurityConfig,
  CloudflareWorkerSecurityCorsConfig,
  CloudflareWorkerSecurityCspConfig,
  CloudflareWorkerSecurityCspMode,
  CloudflareWorkerSecurityNoindexConfig,
  DeployTarget,
} from './cloudflareDeploy';

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
  worker?: {
    name?: string;
    /**
     * Cloudflare Workers compatibility date for generated wrangler config.
     * Use YYYY-MM-DD. Defaults to the date validated against the bundled
     * Wrangler version used by UltraModern generated workspaces.
     */
    compatibilityDate?: string;
    ssr?: boolean;
    security?: CloudflareWorkerSecurityConfig;
  };
}
