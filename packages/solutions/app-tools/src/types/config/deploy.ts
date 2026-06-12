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

export type DeployTarget =
  | 'node'
  | 'vercel'
  | 'netlify'
  | 'ghPages'
  | 'cloudflare';

export type CloudflareWorkerSecurityCspMode = 'enforce' | 'report-only' | 'off';

export interface CloudflareWorkerSecurityCspConfig {
  mode?: CloudflareWorkerSecurityCspMode;
  directives?: Record<string, string[] | string | false>;
  additionalScriptSrc?: string[];
  additionalStyleSrc?: string[];
  additionalConnectSrc?: string[];
  additionalImgSrc?: string[];
  frameAncestors?: string[] | false;
  reportUri?: string;
  reason?: string;
}

export interface CloudflareWorkerSecurityNoindexConfig {
  workersDev?: boolean;
  localhost?: boolean;
  previewHostnames?: string[];
  reason?: string;
}

export interface CloudflareWorkerSecurityConfig {
  /**
   * Disable all Cloudflare worker security defaults for this app.
   * Prefer narrower escape hatches when possible.
   */
  enabled?: boolean;
  headers?: {
    referrerPolicy?: string | false;
    contentTypeOptions?: 'nosniff' | false;
    permissionsPolicy?: string | false;
  };
  contentSecurityPolicy?: CloudflareWorkerSecurityCspConfig;
  noindex?: boolean | CloudflareWorkerSecurityNoindexConfig;
  cookies?: {
    /**
     * Cloudflare worker does not mutate application Set-Cookie headers by
     * default; app-owned cookies should be secured by the owner that sets them.
     */
    mutateSetCookie?: false;
    reason?: string;
  };
  reason?: string;
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
