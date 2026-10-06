import { nativeModuleManifestFilename } from '@modern-js/renderer-core/identity';
import type { NativeCompilerArtifacts } from '../../native-composition/compiler-artifacts';

const clientManifestFile = (entryName: string) =>
  nativeModuleManifestFilename('solid', entryName);

export const solidCompilerArtifacts = Object.freeze<NativeCompilerArtifacts>({
  routerFrameworks: ['solid'],
  clientManifestFile,
  async validateClientManifest(value, identity) {
    const { validateSolidModuleManifest } = await import(
      '@modern-js/renderer-solid/manifest'
    );
    return { nativeManifest: validateSolidModuleManifest(value, identity) };
  },
  isMutableDevelopmentAsset(filename, entryNames) {
    return entryNames.some(entry => filename === clientManifestFile(entry));
  },
});
