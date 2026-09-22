import PATCH_INVENTORY from './patch-inventory';

export const SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES = PATCH_INVENTORY.filter(
  patch => patch.repository && patch.workspace !== null,
).map(patch => patch.path.slice('patches/'.length));
