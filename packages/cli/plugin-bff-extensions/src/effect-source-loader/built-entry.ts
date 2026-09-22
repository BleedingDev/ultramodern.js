import { fs, upath as path } from '@modern-js/utils';

import {
  emittedEffectEntry,
  relativeEffectAppPath,
  resolveEffectEntryFile,
} from './paths';

export function resolveBuiltEffectEntry(
  appDirectory: string,
  distDirectory: string,
  sourceEntry: string | undefined,
): string | undefined {
  if (sourceEntry === undefined || sourceEntry.length === 0) {
    return undefined;
  }
  const relativeEntry = relativeEffectAppPath(appDirectory, sourceEntry);
  if (relativeEntry === undefined) {
    throw new Error(
      `Effect BFF entry must be inside the application directory: ${sourceEntry}`,
    );
  }
  const builtEntry = emittedEffectEntry(
    path.resolve(distDirectory, relativeEntry),
  );
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
  const { bundleEffectEntryForNode } = await import('./loader');
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
      ? emittedEffectEntry(path.relative(appDir, sourceEffectEntry))
      : '';
  return { sourceEffectEntry, relativeEffectEntry };
}
