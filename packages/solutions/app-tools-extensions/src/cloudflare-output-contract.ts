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
// Import availability for the default 2026-06-02 nodejs_compat target.
// Some modules are runtime-provided stubs whose unsupported operations throw.
export const CLOUDFLARE_WORKER_NODE_BUILTINS = [
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'process',
  'readline',
  'readline/promises',
  'repl',
  'sqlite',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
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
  // Without this flag, a deployed Worker's `request.signal` never fires on
  // client disconnect, so SSR keeps rendering and streaming after the client
  // has gone away. The native request/session layer (see
  // renderer-core/src/session/request.ts) already forwards `request.signal`
  // into its render-abort `AbortController`; this flag is what makes the
  // platform actually raise that signal in production.
  'enable_request_signal',
] as const;
