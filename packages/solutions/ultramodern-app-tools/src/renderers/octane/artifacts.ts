import type { NativeCompilerArtifacts } from '../../native-composition/compiler-artifacts';

function clientManifestFile(entryName: string): string {
  if (typeof entryName !== 'string' || !entryName.trim())
    throw new Error(
      'Octane module manifests require an application entry name.',
    );
  return `octane-module-manifest.${encodeURIComponent(entryName)}.json`;
}

export const octaneCompilerArtifacts = Object.freeze<NativeCompilerArtifacts>({
  routerFrameworks: ['octane'],
  clientManifestFile,
  async validateClientManifest(value, identity, context) {
    const hydrationBuildId =
      context.compilationHash ?? context.hydrationBuildId;
    if (
      context.development &&
      (typeof hydrationBuildId !== 'string' || !hydrationBuildId.trim())
    )
      throw new Error(
        'Octane development snapshot has no native hydration build.',
      );
    const { validateOctaneModuleManifest } = await import(
      '@modern-js/renderer-octane/manifest'
    );
    const nativeManifest = validateOctaneModuleManifest(
      value,
      identity,
      hydrationBuildId,
    );
    return {
      nativeManifest,
      hydrationBuildId: nativeManifest.nativeHydrationBuildId,
    };
  },
  isMutableDevelopmentAsset(filename, entryNames) {
    return (
      filename === 'octane-client-build.json' ||
      entryNames.some(entry => filename === clientManifestFile(entry))
    );
  },
});
