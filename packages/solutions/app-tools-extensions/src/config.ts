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

export interface CloudflareWorkerPublicAssetConfig {
  /**
   * Source file or directory, relative to the app root, to copy into
   * Cloudflare Worker Static Assets.
   */
  from: string;
  /**
   * Destination path relative to `.output/public`.
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

export interface CloudflareWorkerServiceBindingConfig {
  /** Worker binding name exposed on the module worker `env` object. */
  binding: string;
  /** Target Cloudflare Worker service name. */
  service: string;
  /**
   * Optional application path prefix that Modern.js should dispatch to this
   * service binding with `env[binding].fetch(request)`.
   */
  prefix?: string;
  /**
   * Server-rendered Module Federation fragments exposed by this Worker.
   * These fields are written to the Modern.js worker manifest, but stripped
   * from Wrangler's `services` entries.
   */
  fragments?: CloudflareWorkerServiceBindingFragmentConfig[];
}

export interface CloudflareWorkerServiceBindingFragmentConfig {
  /** Stable remote id used by the shell's composition contract. */
  remote: string;
  /** Module Federation expose rendered by the fragment route. */
  expose: string;
  /** Expected boundary marker in the rendered fragment HTML. */
  boundaryId: string;
  /**
   * Route path on the bound Worker. `{locale}` is replaced with the first
   * locale segment from the incoming shell request.
   */
  path: string;
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

export interface CloudflareDeployConfig {
  worker?: {
    name?: string;
    compatibilityDate?: string;
    ssr?: boolean;
    security?: CloudflareWorkerSecurityConfig;
    wrangler?: Record<string, JsonValue>;
    artifacts?: CloudflareWorkerArtifactConfig[];
    publicAssets?: CloudflareWorkerPublicAssetConfig[];
    d1Databases?: CloudflareWorkerD1DatabaseConfig[];
    services?: CloudflareWorkerServiceBindingConfig[];
    publicAssetExcludes?: string[];
  };
}
