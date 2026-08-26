import {
  ensureGeneratedPatchFile,
  removeGeneratedPatchFileIfUnchanged,
} from './generated-patches';
import type { MigrationIo } from './io';
import {
  drizzleOrmDeclarationPatchPath,
  drizzleOrmDeclarationPatchSourcePath,
  moduleFederationBridgeReactPatchPath,
  moduleFederationBridgeReactPatchSourcePath,
  moduleFederationDtsPluginPatchPath,
  moduleFederationDtsPluginPatchSourcePath,
  moduleFederationModernJsPatchPath,
  moduleFederationModernJsPatchSourcePath,
  tanstackRouterCorePatchPath,
  tanstackRouterCorePatchSourcePath,
} from './policy-constants';

export function ensureGeneratedDeclarationPatches(
  io: MigrationIo,
  options: { includeDrizzleOrmPatch: boolean },
) {
  let changed = false;
  changed =
    ensureGeneratedPatchFile(
      io,
      moduleFederationModernJsPatchPath,
      moduleFederationModernJsPatchSourcePath,
    ) || changed;
  changed =
    ensureGeneratedPatchFile(
      io,
      moduleFederationDtsPluginPatchPath,
      moduleFederationDtsPluginPatchSourcePath,
    ) || changed;
  changed =
    ensureGeneratedPatchFile(
      io,
      moduleFederationBridgeReactPatchPath,
      moduleFederationBridgeReactPatchSourcePath,
    ) || changed;
  changed =
    ensureGeneratedPatchFile(
      io,
      tanstackRouterCorePatchPath,
      tanstackRouterCorePatchSourcePath,
    ) || changed;
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
