import type { NativeCompilerArtifacts } from '@modern-js/renderer-core/adapter';
import { nativeModuleManifestFilename } from '@modern-js/renderer-core/identity';
import { validateSolidModuleManifest } from '../manifest';

const clientManifestFile = (entryName: string) =>
  nativeModuleManifestFilename('solid', entryName);

export const solidCompilerArtifacts: NativeCompilerArtifacts = {
  clientManifestFile,
  async validateClientManifest(value, identity) {
    return { nativeManifest: validateSolidModuleManifest(value, identity) };
  },
  isMutableDevelopmentAsset(filename, entryNames) {
    return entryNames.some(entry => filename === clientManifestFile(entry));
  },
};
