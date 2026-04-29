export const debug = (...args: unknown[]) => {
  if (process.env.MODERN_DEBUG || process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[prod-server]', ...args);
  }
};
