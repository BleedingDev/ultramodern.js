import { collectDocumentAssets, type DocumentAsset } from '../document';
import {
  assertRendererIdentity,
  type Renderer,
  type RendererIdentity,
} from '../identity';

export const RENDERER_ASSET_MANIFEST_FILE = 'renderer-assets.json';

export interface NativeClientAssetManifest {
  readonly schema: 'ultramodern-renderer-assets';
  readonly version: 1;
  readonly renderer: Exclude<Renderer, 'react'>;
  readonly entries: Readonly<
    Record<
      string,
      {
        readonly rendererIdentity: RendererIdentity;
        readonly assets: readonly DocumentAsset[];
      }
    >
  >;
}

/** Read actual emitted initial assets, never infer URLs from source filenames. */
export function validateNativeClientAssetManifest(
  value: unknown,
  expectedIdentity: RendererIdentity,
): readonly DocumentAsset[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'Missing native client asset manifest. Rebuild the application before serving.',
    );
  }
  const manifest = value as Partial<NativeClientAssetManifest>;
  if (
    manifest.schema !== 'ultramodern-renderer-assets' ||
    manifest.version !== 1 ||
    expectedIdentity.renderer === 'react' ||
    manifest.renderer !== expectedIdentity.renderer
  ) {
    throw new Error(
      'Native client asset manifest conflicts with the selected renderer or schema.',
    );
  }
  const entry = manifest.entries?.[expectedIdentity.entryName];
  if (!entry?.rendererIdentity || !Array.isArray(entry.assets)) {
    throw new Error(
      `Native client asset manifest is missing entry ${expectedIdentity.entryName}.`,
    );
  }
  assertRendererIdentity(entry.rendererIdentity, expectedIdentity);
  const assets = collectDocumentAssets(entry.assets);
  if (!assets.some(asset => asset.kind === 'script')) {
    throw new Error(
      `Native client asset manifest has no application script for ${expectedIdentity.entryName}.`,
    );
  }
  return assets;
}
