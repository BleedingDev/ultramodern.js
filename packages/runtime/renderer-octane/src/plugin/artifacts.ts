import type { NativeCompilerArtifacts } from '@modern-js/renderer-core/adapter';
import { nativeModuleManifestFilename } from '@modern-js/renderer-core/identity';
import { validateOctaneModuleManifest } from '../manifest';

const clientManifestFile = (entryName: string) =>
  nativeModuleManifestFilename('octane', entryName);

export const octaneCompilerArtifacts: NativeCompilerArtifacts = {
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
};
