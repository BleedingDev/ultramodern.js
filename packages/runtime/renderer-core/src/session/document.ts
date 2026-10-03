import { escapeInlineDataJSON, type InlineDataJSON } from '../data/codec';

export interface DocumentAsset {
  readonly kind: 'stylesheet' | 'modulepreload' | 'script';
  readonly href: string;
  readonly integrity?: string;
  readonly crossOrigin?: 'anonymous' | 'use-credentials';
  readonly scriptType?: 'module' | 'classic';
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function validateAsset(asset: DocumentAsset): void {
  if (!['stylesheet', 'modulepreload', 'script'].includes(asset.kind)) {
    throw new TypeError('A document asset has an unknown kind.');
  }
  if (
    typeof asset.href !== 'string' ||
    asset.href.length === 0 ||
    asset.href.trim() !== asset.href ||
    /[\u0000-\u0020\u007f]/u.test(asset.href)
  ) {
    throw new TypeError(
      'A document asset requires a nonempty URL without whitespace or control characters.',
    );
  }
  const url = new URL(asset.href, 'https://ultramodern.invalid/');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(
      'A document asset must use an HTTP URL or relative URL.',
    );
  }
  if (
    asset.crossOrigin !== undefined &&
    asset.crossOrigin !== 'anonymous' &&
    asset.crossOrigin !== 'use-credentials'
  ) {
    throw new TypeError('A document asset has an unknown crossOrigin value.');
  }
  if (
    asset.scriptType !== undefined &&
    (asset.kind !== 'script' ||
      !['module', 'classic'].includes(asset.scriptType))
  ) {
    throw new TypeError(
      'Only a script asset can declare module or classic scriptType.',
    );
  }
}

/** Preserve the native adapter's order. Equal asset claims collapse; conflicts fail. */
export function collectDocumentAssets(
  assets: readonly DocumentAsset[],
): readonly DocumentAsset[] {
  const collected = new Map<string, DocumentAsset>();
  for (const asset of assets) {
    validateAsset(asset);
    const key = JSON.stringify([asset.kind, asset.href]);
    const existing = collected.get(key);
    if (existing) {
      if (
        existing.integrity !== asset.integrity ||
        existing.crossOrigin !== asset.crossOrigin ||
        (existing.scriptType ?? 'module') !== (asset.scriptType ?? 'module')
      ) {
        throw new Error(
          `Conflicting document asset metadata for ${asset.href}.`,
        );
      }
      continue;
    }
    collected.set(key, Object.freeze({ ...asset }));
  }
  return Object.freeze([...collected.values()]);
}

function nonceAttribute(nonce: string | undefined): string {
  if (nonce === undefined) return '';
  if (typeof nonce !== 'string' || nonce.length === 0) {
    throw new TypeError('A document nonce must be a nonempty string.');
  }
  return ` nonce="${escapeAttribute(nonce)}"`;
}

/** Serialize asset metadata only. The native renderer decides its document position. */
export function serializeDocumentAsset(
  asset: DocumentAsset,
  nonce?: string,
  options: { readonly async?: boolean; readonly defer?: boolean } = {},
): string {
  validateAsset(asset);
  if (
    options.async !== undefined &&
    (asset.kind !== 'script' || typeof options.async !== 'boolean')
  ) {
    throw new TypeError(
      'Async scheduling is only available for a script asset.',
    );
  }
  if (
    options.defer !== undefined &&
    (asset.kind !== 'script' || typeof options.defer !== 'boolean')
  ) {
    throw new TypeError(
      'Deferred scheduling is only available for a script asset.',
    );
  }
  if (options.async === true && options.defer === true) {
    throw new TypeError('A script asset cannot be both async and deferred.');
  }
  const url = escapeAttribute(asset.href);
  const integrity =
    asset.integrity === undefined
      ? ''
      : ` integrity="${escapeAttribute(asset.integrity)}"`;
  const crossOrigin =
    asset.crossOrigin === undefined
      ? ''
      : ` crossorigin="${asset.crossOrigin}"`;
  const attributes = `${integrity}${crossOrigin}${nonceAttribute(nonce)}`;
  if (asset.kind === 'script') {
    const scriptType = asset.scriptType ?? 'module';
    const type = scriptType === 'module' ? ' type="module"' : '';
    const scheduling = options.async
      ? ' async'
      : options.defer === true ||
          (scriptType === 'classic' && options.defer !== false)
        ? ' defer'
        : '';
    return `<script${type}${scheduling} src="${url}"${attributes}></script>`;
  }
  return `<link rel="${asset.kind}" href="${url}"${attributes}>`;
}

/** The native bootstrap must consume this public data before importing dependent modules. */
export function serializeInlineData(input: {
  readonly id: string;
  readonly payload: InlineDataJSON;
  readonly nonce?: string;
}): string {
  if (typeof input.id !== 'string' || input.id.length === 0) {
    throw new TypeError('An inline data element requires a nonempty id.');
  }
  const payload = escapeInlineDataJSON(input.payload);
  return `<script type="application/json" id="${escapeAttribute(input.id)}"${nonceAttribute(input.nonce)}>${payload}</script>`;
}
