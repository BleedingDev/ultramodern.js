import {
  ensureGeneratedPatchFile,
  removeGeneratedPatchFileIfUnchanged,
} from './generated-patches';
import type { MigrationIo } from './io';
import {
  drizzleOrmDeclarationPatchPath,
  drizzleOrmDeclarationPatchSourcePath,
  requiredGeneratedPatches,
} from './policy-constants';

export function ensureGeneratedDeclarationPatches(
  io: MigrationIo,
  options: { includeDrizzleOrmPatch: boolean },
) {
  let changed = false;
  for (const patch of requiredGeneratedPatches) {
    changed =
      ensureGeneratedPatchFile(io, patch.path, patch.sourcePath) || changed;
  }
  if (options.includeDrizzleOrmPatch) {
    changed =
      ensureGeneratedPatchFile(
        io,
        drizzleOrmDeclarationPatchPath,
        drizzleOrmDeclarationPatchSourcePath,
      ) || changed;
  } else {
    changed =
      removeGeneratedPatchFileIfUnchanged(
        io,
        drizzleOrmDeclarationPatchPath,
        drizzleOrmDeclarationPatchSourcePath,
      ) || changed;
  }
  return changed;
}
