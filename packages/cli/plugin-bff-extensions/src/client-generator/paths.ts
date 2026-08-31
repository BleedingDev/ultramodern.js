import { findExists, fs, upath as path } from '@modern-js/utils';

const JS_OR_TS_EXTS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;

export function resolveEffectEntryFile(options: {
  appDir: string;
  apiDir: string;
  effectEntry?: string;
}) {
  const { appDir, apiDir, effectEntry } = options;

  const resolveEntry = (entryWithoutExt: string) => {
    if (path.extname(entryWithoutExt) !== '') {
      return fs.existsSync(entryWithoutExt) ? entryWithoutExt : undefined;
    }

    return findExists(JS_OR_TS_EXTS.map(ext => `${entryWithoutExt}${ext}`));
  };

  if (effectEntry !== undefined && effectEntry !== '') {
    const entryWithoutExt = path.isAbsolute(effectEntry)
      ? effectEntry
      : path.resolve(appDir, effectEntry);
    return resolveEntry(entryWithoutExt);
  }

  return resolveEntry(path.resolve(apiDir, 'index'));
}
