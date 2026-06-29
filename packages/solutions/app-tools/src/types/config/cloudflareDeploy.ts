export type DeployTarget =
  | 'node'
  | 'vercel'
  | 'netlify'
  | 'ghPages'
  | 'cloudflare';

export type CloudflareWorkerSecurityCspMode = 'enforce' | 'report-only' | 'off';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CloudflareWorkerArtifactConfig {
  /**
   * Source file or directory, relative to the app root, to copy into
   * `.output` after framework output has been staged.
   */
  from: string;
  /**
   * Destination path relative to `.output`.
   */
  to: string;
}

export interface CloudflareWorkerD1DatabaseConfig {
  /**
   * Worker binding name, for example `DB`.
   */
  binding: string;
  /**
   * Cloudflare D1 database name.
   */
  databaseName: string;
  /**
   * Cloudflare D1 database id.
   */
  databaseId: string;
  /**
   * Optional local migrations directory, relative to the app root. When set,
   * Modern.js stages it into `.output` and points Wrangler at the staged copy.
   */
  migrationsDir?: string;
  /**
   * Optional preview database id used by Wrangler preview/local flows.
   */
  previewDatabaseId?: string;
  /**
   * Wrangler remote flag for D1 commands.
   */
  remote?: boolean;
}

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
