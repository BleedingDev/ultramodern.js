import {
  OCTANE_COMPILER_VERSION,
  OCTANE_RUNTIME_VERSION,
  type OctaneCompiledSource,
  type OctaneModuleManifest,
  octaneModuleManifestFileName,
  validateOctaneModuleManifest,
} from '@bleedingdev/modern-js-renderer-octane/manifest';

export function manifestPublicProgram(
  supplied: unknown,
  identity: OctaneModuleManifest['rendererIdentity'],
): {
  authored: OctaneModuleManifest;
  supplied: OctaneModuleManifest;
  filename: string;
} {
  const source: OctaneCompiledSource = {
    resource: 'src/App.tsrx',
    canonicalId: 'public-sdk:src/App.tsrx',
    moduleId: './src/App.tsrx',
    transformKind: 'compile',
    sourceSha256: 'a'.repeat(64),
    emittedSourceSha256: 'b'.repeat(64),
    assets: ['static/js/main.js'],
  };
  const manifest: OctaneModuleManifest = {
    schemaVersion: 1,
    renderer: 'octane',
    runtimeVersion: OCTANE_RUNTIME_VERSION,
    compilerVersion: OCTANE_COMPILER_VERSION,
    rendererIdentity: identity,
    nativeHydrationBuildId: 'native-client-compilation',
    sourceModules: [source],
    assets: [{ file: 'static/js/main.js', sha256: 'c'.repeat(64) }],
  };
  const authored: OctaneModuleManifest = validateOctaneModuleManifest(
    manifest,
    identity,
    manifest.nativeHydrationBuildId,
  );
  const admitted: OctaneModuleManifest = validateOctaneModuleManifest(
    supplied,
    identity,
  );
  const filename: string = octaneModuleManifestFileName(identity.entryName);
  return { authored, supplied: admitted, filename };
}
