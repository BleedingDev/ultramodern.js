import { escapeInlineDataJSON } from './data/codec';
import { type RendererIdentity, readRendererIdentity } from './identity';

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

/**
 * Frame JSON text as an inert `<script type="application/json">` element.
 * This is the one place inline document data is escaped for HTML.
 */
export function serializeInlineData(input: {
  readonly id: string;
  /** JSON text, such as `serializePublicData` output or `JSON.stringify`. */
  readonly payload: string;
  readonly nonce?: string;
}): string {
  if (typeof input.id !== 'string' || input.id.length === 0) {
    throw new TypeError('An inline data element requires a nonempty id.');
  }
  const payload = escapeInlineDataJSON(input.payload);
  return `<script type="application/json" id="${escapeAttribute(input.id)}"${nonceAttribute(input.nonce)}>${payload}</script>`;
}

/** Element id of the renderer bootstrap every native client reads first. */
export const RENDERER_BOOTSTRAP_ID = '__ULTRAMODERN_RENDERER__';

/** What the server tells the client about the document before it starts. */
export interface DocumentBootstrap {
  readonly identity: Readonly<RendererIdentity>;
  /** The renderer's hydration/render id for this response. */
  readonly documentId: string;
  readonly hydrating: boolean;
}

/** Public JSON a client module reads from the document before it starts. */
export interface DocumentInlineData {
  readonly id: string;
  /** JSON text; `serializeInlineData` escapes it for HTML. */
  readonly payload: string;
}

export interface DocumentNonce {
  readonly script?: string;
  readonly style?: string;
}

export interface DocumentOptions {
  readonly rootId?: string;
  readonly lang?: string;
  readonly nonce?: DocumentNonce;
  readonly assets?: readonly DocumentAsset[];
  /** Placed right after the renderer bootstrap, before entry scripts. */
  readonly inlineData?: readonly DocumentInlineData[];
}

/** HTML fragments a native adapter places in its own document shell. */
export interface DocumentParts {
  /** Escaped attribute values. */
  readonly rootId: string;
  readonly lang: string;
  /** Stylesheets and module preloads. */
  readonly headAssets: string;
  /** The renderer bootstrap followed by the inline data elements. */
  readonly bootstrap: string;
  /** Entry scripts, scheduled so hydration starts before the stream ends. */
  readonly entryScripts: string;
}

function documentAttribute(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`A native document requires a nonempty ${name}.`);
  }
  return escapeAttribute(value);
}

/**
 * Prepare the renderer-neutral parts of a native HTML document: assets, the
 * renderer bootstrap and inline data. `extra` adds renderer-specific bootstrap
 * fields, which the client reads with `readDocumentBootstrap`.
 */
export function prepareDocument(
  bootstrap: DocumentBootstrap & Readonly<Record<string, unknown>>,
  options: DocumentOptions = {},
): DocumentParts {
  if (
    typeof bootstrap.documentId !== 'string' ||
    !bootstrap.documentId.trim()
  ) {
    throw new TypeError('A native document requires a nonempty document id.');
  }
  if (typeof bootstrap.hydrating !== 'boolean') {
    throw new TypeError(
      'A native document must identify whether its root requires hydration.',
    );
  }
  readRendererIdentity(bootstrap.identity, bootstrap.identity);
  const rootId = options.rootId ?? 'root';
  const root = documentAttribute(rootId, 'rootId');
  const lang = documentAttribute(options.lang ?? 'en', 'lang');
  if (rootId === RENDERER_BOOTSTRAP_ID) {
    throw new TypeError('A document root cannot reuse the bootstrap id.');
  }
  const { script, style } = options.nonce ?? {};
  const inlineIds = new Set<string>();
  const inlineData = (options.inlineData ?? []).map(item => {
    if (item.id === RENDERER_BOOTSTRAP_ID || item.id === rootId) {
      throw new TypeError(
        'Document inline data cannot reuse the root or bootstrap id.',
      );
    }
    // Readers use getElementById, so a repeated id hides one payload.
    if (inlineIds.has(item.id))
      throw new TypeError(`Document inline data id ${item.id} is repeated.`);
    inlineIds.add(item.id);
    return serializeInlineData({ ...item, nonce: script });
  });
  const assets = collectDocumentAssets(options.assets ?? []);
  return {
    rootId: root,
    lang,
    headAssets: assets
      .filter(asset => asset.kind !== 'script')
      .map(asset =>
        serializeDocumentAsset(
          asset,
          asset.kind === 'stylesheet' ? style : script,
        ),
      )
      .join(''),
    bootstrap:
      serializeInlineData({
        id: RENDERER_BOOTSTRAP_ID,
        payload: JSON.stringify(bootstrap),
        nonce: script,
      }) + inlineData.join(''),
    entryScripts: assets
      .filter(asset => asset.kind === 'script')
      .map(asset =>
        serializeDocumentAsset(
          asset,
          script,
          // Hydration starts while deferred native fragments keep the stream
          // open. Classic chunks keep their manifest (parser) order.
          !bootstrap.hydrating
            ? {}
            : asset.scriptType === 'classic'
              ? { defer: false }
              : { async: true },
        ),
      )
      .join(''),
  };
}

/**
 * Read the server's bootstrap before creating a native router or owner. The
 * identity must equal the client's build identity. Renderer-specific fields
 * must be named in `extraFields` and are returned for the adapter to check.
 */
export function readDocumentBootstrap(
  document: Pick<Document, 'querySelectorAll'>,
  expectedIdentity: RendererIdentity,
  extraFields: readonly string[] = [],
): DocumentBootstrap & Readonly<Record<string, unknown>> {
  const elements = document.querySelectorAll(`[id="${RENDERER_BOOTSTRAP_ID}"]`);
  if (elements.length !== 1) {
    throw new Error(
      'A native document requires exactly one renderer bootstrap.',
    );
  }
  const element = elements.item(0);
  if (
    !element ||
    element.tagName !== 'SCRIPT' ||
    element.getAttribute('type') !== 'application/json'
  ) {
    throw new Error('The native document is missing its renderer bootstrap.');
  }
  const payload: unknown = JSON.parse(element.textContent ?? '');
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some(
      key =>
        !['identity', 'documentId', 'hydrating', ...extraFields].includes(key),
    )
  ) {
    throw new Error('The native renderer bootstrap is malformed.');
  }
  const fields = payload as Record<string, unknown>;
  const identity = readRendererIdentity(fields.identity, expectedIdentity);
  if (typeof fields.documentId !== 'string' || !fields.documentId.trim()) {
    throw new Error('The native renderer bootstrap requires a document id.');
  }
  if (typeof fields.hydrating !== 'boolean') {
    throw new Error(
      'The native renderer bootstrap must say whether its root hydrates.',
    );
  }
  return Object.freeze({ ...fields, identity }) as DocumentBootstrap &
    Readonly<Record<string, unknown>>;
}
