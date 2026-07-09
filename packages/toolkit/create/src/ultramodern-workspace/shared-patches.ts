export const SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES = [
  '@module-federation__bridge-react@2.7.0.patch',
  '@module-federation__dts-plugin@2.7.0.patch',
  '@module-federation__modern-js-v3@2.7.0.patch',
  '@tanstack__router-core@1.171.14.patch',
] as const;

type SharedUltramodernWorkspacePatchFile =
  (typeof SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES)[number];
