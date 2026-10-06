import { nativeModuleManifestFilename } from '@modern-js/renderer-core/identity';
import type { NativeCompilerArtifacts } from '../../native-composition/compiler-artifacts';

const clientManifestFile = (entryName: string) =>
  nativeModuleManifestFilename('octane', entryName);

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
