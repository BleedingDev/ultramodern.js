import { fs, upath as path } from '@modern-js/utils';

import { resolveEffectEntryFile } from './paths';

const BUILT_ENTRY_EXT = /\.(?:[cm]?ts|tsx|jsx)$/u;

export function resolveBuiltEffectEntry(
  appDirectory: string,
  distDirectory: string,
  sourceEntry: string | undefined,
): string | undefined {
  if (sourceEntry === undefined || sourceEntry.length === 0) {
    return undefined;
  }
  const relativeEntry = path.relative(appDirectory, sourceEntry);
  if (relativeEntry === '..' || relativeEntry.startsWith(`..${path.sep}`)) {
    throw new Error(
      `Effect BFF entry must be inside the application directory: ${sourceEntry}`,
    );
  }
  const builtEntry = path
    .resolve(distDirectory, relativeEntry)
    .replace(BUILT_ENTRY_EXT, '.js');
  return fs.existsSync(builtEntry) ? builtEntry : undefined;
}

export async function bundleBuiltEffectEntryForNode(options: {
  appDir: string;
  apiDir: string;
  distDir: string;
  effectEntry?: string;
  format: 'cjs' | 'esm';
}) {
  const { appDir, apiDir, distDir, effectEntry, format } = options;
  const sourceEntry = resolveEffectEntryFile({ appDir, apiDir, effectEntry });
  const builtEntry = resolveBuiltEffectEntry(appDir, distDir, sourceEntry);
  if (builtEntry === undefined || builtEntry.length === 0) {
    throw new Error(
      `Effect BFF entry was not emitted into ${distDir}: ${
        sourceEntry ?? path.resolve(apiDir, 'index')
      }`,
    );
  }
  const { bundleEffectEntryForNode } = await import(
    '../effect-source-loader/loader'
  );
  return bundleEffectEntryForNode({
    appDir,
    entryPath: builtEntry,
    format,
  });
}

export function resolveEffectEntryPaths(options: {
  appDir: string;
  apiDir: string;
  effectEntry?: string;
}): { sourceEffectEntry: string | undefined; relativeEffectEntry: string } {
  const { appDir, apiDir, effectEntry } = options;
  const sourceEffectEntry = resolveEffectEntryFile({
    appDir,
    apiDir,
    effectEntry,
  });
  const relativeEffectEntry =
    sourceEffectEntry !== undefined && sourceEffectEntry.length > 0
      ? path.relative(appDir, sourceEffectEntry).replace(BUILT_ENTRY_EXT, '.js')
      : '';
  return { sourceEffectEntry, relativeEffectEntry };
}
