export const CLOUDFLARE_WORKER_ENTRY = 'server/index.mjs';
export const CLOUDFLARE_WORKER_MANIFEST = 'server/modern-worker-manifest.json';
export const CLOUDFLARE_WRANGLER_CONFIG_FILE = 'wrangler.json';
export const CLOUDFLARE_OUTPUT_PACKAGE_FILE = 'package.json';
export const CLOUDFLARE_WORKER_PACKAGE_FILE = 'worker/package.json';
export const CLOUDFLARE_ASSETS_BINDING = 'ASSETS';
export const CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY = 'public';
export const CLOUDFLARE_WORKER_BUNDLE_DIRECTORY = 'worker';
export const CLOUDFLARE_RUNTIME_TYPE = 'cloudflare-module-worker';
export const CLOUDFLARE_OUTPUT_PACKAGE_TYPE = 'module';
export const CLOUDFLARE_WORKER_PACKAGE_TYPE = 'commonjs';
export const CLOUDFLARE_WORKER_BUNDLE_FORMAT = 'commonjs';
// Each SSR entry with route data loaders gets a worker bundle that answers
// `?__loader=` route data requests through this export.
export const CLOUDFLARE_ROUTE_DATA_HANDLER_EXPORT = 'handleRouteDataRequest';
export const getCloudflareWorkerRouteDataEntryName = (entryName: string) =>
  `${entryName}-server-loaders`;
// Every Node.js built-in that workerd resolves for the default 2026-06-02
// nodejs_compat target (tests/cloudflare-worker-node-builtins.test.ts probes
// workerd against Node's own `builtinModules`). Names are listed without the
// `node:` scheme; bare-name imports are only valid where Node itself accepts
// them (`isBuiltin`), so prefix-only modules such as `sqlite` and `test` are
// externalized solely as `node:sqlite` and `node:test`. Some modules are
// runtime-provided stubs whose unsupported operations throw. Earlier
// compatibility dates are rejected when the Wrangler config is generated.
export const CLOUDFLARE_WORKER_NODE_BUILTINS = [
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_tls_common',
  '_tls_wrap',
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'sqlite',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'test',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
] as const;
// Platform imports available with the default 2026-06-02 nodejs_compat target.
// Import availability does not imply support for every Node API operation.
export const CLOUDFLARE_WORKER_PLATFORM_MODULES = [
  'cloudflare:sockets',
] as const;
export const CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS = [
  'nodejs_compat',
  'global_fetch_strictly_public',
] as const;
