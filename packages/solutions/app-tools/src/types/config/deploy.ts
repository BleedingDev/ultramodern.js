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

export interface CloudflareWorkerSecurityCorsConfig {
  /**
   * Origins allowed to read application responses (BFF APIs, SSR HTML,
   * route fallbacks) cross-origin. Accepts exact origins
   * (e.g. `https://shell.example.com`) or `'*'`.
   * When empty, application responses carry no CORS headers (same-origin).
   * @default []
   */
  allowedOrigins?: string[];
  /**
   * Methods advertised on CORS preflight responses for application routes.
   * @default ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
   */
  allowedMethods?: string[];
  /**
   * Headers advertised on CORS preflight responses for application routes.
   * @default ['*']
   */
  allowedHeaders?: string[];
  /**
   * Apply wildcard CORS to static asset responses so federated remotes
   * (remote entries, manifests, CSS) can be loaded cross-origin.
   * @default true
   */
  assets?: boolean;
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
  /**
   * Cross-origin resource sharing policy applied by the generated worker.
   * Asset responses default to wildcard CORS for federated loading;
   * application responses (BFF, SSR) default to no CORS headers.
   */
  cors?: CloudflareWorkerSecurityCorsConfig;
  /**
   * @deprecated Write-only: this option never had any runtime effect — the
   * generated worker never mutates application `Set-Cookie` headers.
   * Kept temporarily so configs emitted by existing `modern create`
   * templates keep typechecking; will be removed once the generator stops
   * emitting it. Use {@link CloudflareWorkerSecurityConfig.cors} for the
   * worker's cross-origin policy.
   */
  cookies?: {
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
