import type { NativeCompilerArtifacts } from '../../native-composition/compiler-artifacts';

function clientManifestFile(entryName: string): string {
  if (typeof entryName !== 'string' || !entryName.length)
    throw new Error('A Solid module manifest requires a nonempty entry name');
  return `solid-module-manifest.${encodeURIComponent(entryName)}.json`;
}

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
