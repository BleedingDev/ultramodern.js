/**
 * The bundler environment Modern.js compiles this module for. The framework
 * replaces it at build time with the same value as `process.env.MODERN_TARGET`,
 * so a strict comparison is a constant that each bundle folds.
 *
 * @example
 * if (import.meta.env.MODERN_TARGET === 'browser') {
 *   // browser-only code, removed from the server bundle
 * }
 */
interface ImportMetaEnv {
  readonly MODERN_TARGET: 'browser' | 'node';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
