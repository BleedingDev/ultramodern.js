/** The native adapter owns the compiler/server/client manifest ABI. */
export {
  OCTANE_COMPILER_VERSION,
  OCTANE_RUNTIME_VERSION,
  type OctaneCompiledSource,
  type OctaneModuleManifest,
  octaneModuleManifestFileName,
  validateOctaneModuleManifest,
} from '@modern-js/renderer-octane/manifest';
