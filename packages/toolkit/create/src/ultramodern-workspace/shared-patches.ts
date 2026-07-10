import { ULTRAMODERN_WORKSPACE_POLICY } from './policy';

export const SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES =
  ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies.required
    .map(patch => patch.path.replace(/^patches\//u, ''))
    .filter(
      patchFile =>
        patchFile.startsWith('@module-federation__') ||
        patchFile.startsWith('@tanstack__'),
    );

type SharedUltramodernWorkspacePatchFile =
  (typeof SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES)[number];
