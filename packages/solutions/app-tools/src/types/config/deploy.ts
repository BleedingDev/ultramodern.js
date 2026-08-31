import type {
  CloudflareWorkerArtifactConfig,
  CloudflareWorkerD1DatabaseConfig,
  CloudflareWorkerPublicAssetConfig,
  CloudflareWorkerSecurityConfig,
  CloudflareWorkerServiceBindingConfig,
  DeployTarget,
  JsonValue,
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
    /**
     * Raw Wrangler-compatible config merged into `.output/wrangler.json`.
     * Framework-owned worker invariants still win for `main`, the assets
     * binding/directory/run mode, and required compatibility flags.
     */
    wrangler?: Record<string, JsonValue>;
    /**
     * Additional app-root files or directories to stage under `.output`.
     * Use this for provider resources such as migrations or generated config.
     */
    artifacts?: CloudflareWorkerArtifactConfig[];
    /**
     * Additional app-root files or directories to serve as Cloudflare Worker
     * Static Assets under `.output/public`. Use `to: '.'` to copy a
     * source directory's contents into the public asset root.
     */
    publicAssets?: CloudflareWorkerPublicAssetConfig[];
    /**
     * First-class Cloudflare D1 bindings. Modern.js writes these to
     * `wrangler.json` as `d1_databases` and stages configured migration
     * directories into `.output`.
     */
    d1Databases?: CloudflareWorkerD1DatabaseConfig[];
    /**
     * First-class Cloudflare service bindings. Modern.js writes these to
     * `wrangler.json` as `services`; when a binding also has `prefix`,
     * the generated Worker dispatches matching requests through
     * `env[binding].fetch(request)`.
     */
    services?: CloudflareWorkerServiceBindingConfig[];
    /**
     * Dist output paths that must not be copied into Cloudflare public assets.
     * Entries are slash-normalized path prefixes relative to the app dist root.
     * Top-level `api` and `shared` dist directories are excluded when matching
     * source directories exist in the app root because they conventionally
     * contain server-only implementation code.
     */
    publicAssetExcludes?: string[];
  };
}
