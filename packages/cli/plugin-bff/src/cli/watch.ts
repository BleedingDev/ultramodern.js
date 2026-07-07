const WATCHABLE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.json',
];

export const isWatchableBffFile = (filename: string) =>
  WATCHABLE_EXTENSIONS.some(ext => filename.endsWith(ext));
