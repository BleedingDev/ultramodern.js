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
];

export const emittedEffectEntry = (entry: string) =>
  entry.replace(/\.(?:[cm]?ts|tsx|jsx)$/u, '.js');

export function relativeEffectAppPath(appDir: string, entry: string) {
  const relative = path.relative(appDir, entry);
  return relative === '..' ||
    relative.startsWith('../') ||
    relative.split('/').includes('node_modules')
    ? undefined
    : relative;
}

function existingEntry(entry: string): string | undefined {
  return path.extname(entry)
    ? fs.existsSync(entry)
      ? entry
      : undefined
    : findExists(JS_OR_TS_EXTS.map(ext => `${entry}${ext}`)) || undefined;
}

type EffectEntryOptions = {
  appDir: string;
  apiDir: string;
  effectEntry?: string;
};
export type EffectEntry =
  | { kind: 'app-source'; path: string | undefined }
  | { kind: 'built-output'; path: string | undefined }
  | { kind: 'external-sdk'; path: string | undefined };

/** Classify ownership before resolving files: production works without source. */
export function resolveEffectEntry(
  options: EffectEntryOptions & { distDir?: string },
): EffectEntry {
  const { appDir, apiDir, effectEntry, distDir } = options;
  const entry = path.resolve(appDir, effectEntry || path.join(apiDir, 'index'));
  if (distDir && relativeEffectAppPath(distDir, entry) !== undefined) {
    return {
      kind: 'built-output',
      path: existingEntry(emittedEffectEntry(entry)),
    };
  }
  const relative = relativeEffectAppPath(appDir, entry);
  if (relative === undefined) {
    return { kind: 'external-sdk', path: existingEntry(entry) };
  }
  return distDir
    ? {
        kind: 'built-output',
        path: existingEntry(
          emittedEffectEntry(path.resolve(distDir, relative)),
        ),
      }
    : { kind: 'app-source', path: existingEntry(entry) };
}

export function resolveEffectEntryFile(
  options: EffectEntryOptions,
): string | undefined {
  return resolveEffectEntry(options).path;
}
