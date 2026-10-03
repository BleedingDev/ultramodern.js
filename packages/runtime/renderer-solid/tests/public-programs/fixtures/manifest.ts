import {
  SOLID_COMPILER_VERSION,
  type SolidAssetChunk,
  type SolidAssetManifest,
  type SolidModuleManifest,
  type SolidPreloadLink,
  solidModuleManifestFilename,
  validateSolidModuleManifest,
} from '@bleedingdev/modern-js-renderer-solid/manifest';
import type { AssetManifest } from '@solidjs/web';

export function manifestPublicProgram(
  supplied: unknown,
  identity: SolidModuleManifest['rendererIdentity'],
): {
  authored: SolidModuleManifest;
  supplied: SolidModuleManifest;
  nativeManifest: AssetManifest;
  filename: string;
} {
  const preload: SolidPreloadLink = {
    href: 'static/js/profile.js',
    as: 'script',
    crossorigin: 'anonymous',
  };
  const chunk: SolidAssetChunk = {
    file: 'static/js/profile.js',
    imports: [],
    css: ['static/css/profile.css'],
    isEntry: true,
    preloads: [preload],
  };
  const modules: SolidAssetManifest = { './src/Profile.tsx': chunk };
  const manifest: SolidModuleManifest = {
    schemaVersion: 1,
    renderer: 'solid',
    compilerVersion: SOLID_COMPILER_VERSION,
    rendererIdentity: identity,
    modules,
  };
  const authored = validateSolidModuleManifest(manifest, identity, [
    './src/Profile.tsx',
  ]);
  const admitted = validateSolidModuleManifest(supplied, identity);
  const nativeManifest: AssetManifest = authored.modules;
  return {
    authored,
    supplied: admitted,
    nativeManifest,
    filename: solidModuleManifestFilename(identity.entryName),
  };
}
