/**
 * The server half of same-renderer Module Federation. The host's generated
 * federation runtime plugin publishes this state when its server compilation
 * consumes remotes; federatedComponent() records the browser assets of every
 * remote it rendered, and the document resolves them by asset key.
 */
export const FEDERATION_SSR = Symbol.for('ultramodern.federation.ssr');

/** Asset keys for server-rendered remotes, e.g. `ultramodern-federation:remote/Widget`. */
export const FEDERATED_ASSET_PREFIX = 'ultramodern-federation:';

export interface FederatedAssets {
  /** The remote entry and the exposed module's synchronous chunks. */
  readonly js: readonly string[];
  readonly css: readonly string[];
}

export interface FederationSSRState {
  /**
   * The host client module, relative to the client asset base, that loads a
   * remote through the host's federation instance before hydration.
   */
  readonly hydrationModule: string;
  readonly assets: Map<string, FederatedAssets>;
}

export function federationSSRState(): FederationSSRState | undefined {
  const state = (globalThis as Record<symbol, unknown>)[FEDERATION_SSR];
  if (
    state === null ||
    typeof state !== 'object' ||
    typeof (state as FederationSSRState).hydrationModule !== 'string' ||
    !((state as FederationSSRState).assets instanceof Map)
  )
    return undefined;
  return state as FederationSSRState;
}

export function federatedAssetKey(id: string): string {
  return `${FEDERATED_ASSET_PREFIX}${id}`;
}

interface ResolvedDocumentAssets {
  js: string[];
  css: string[];
  preloads?: Record<string, unknown>[];
}

interface StaticAssetChunk {
  file: string;
  css?: string[];
  imports?: string[];
  preloads?: Record<string, unknown>[];
}

/** Solid's own asset path join: absolute URLs pass through. */
function joinAssetPath(base: unknown, file: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//iu.test(file)) return file;
  let prefix = typeof base === 'string' && base ? base : '/';
  if (!prefix.endsWith('/')) prefix += '/';
  return prefix + (file.startsWith('/') ? file.slice(1) : file);
}

/** Solid's static manifest walk, so a resolver can extend a static manifest. */
function resolveStaticAssets(
  manifest: Record<string, unknown>,
  key: string,
): ResolvedDocumentAssets | null {
  if (key === '_base' || !Object.hasOwn(manifest, key)) return null;
  const base = manifest._base;
  const js: string[] = [];
  const css: string[] = [];
  let preloads: Record<string, unknown>[] | undefined;
  const visited = new Set<string>();
  const walk = (name: string) => {
    if (visited.has(name) || name === '_base') return;
    visited.add(name);
    const chunk = manifest[name] as StaticAssetChunk | undefined;
    if (!chunk) return;
    js.push(joinAssetPath(base, chunk.file));
    for (const file of chunk.css ?? []) css.push(joinAssetPath(base, file));
    for (const link of chunk.preloads ?? []) {
      const href = typeof link.href === 'string' && link.href;
      if (!href && typeof link.imagesrcset !== 'string') continue;
      preloads ??= [];
      if (href) preloads.push({ ...link, href: joinAssetPath(base, href) });
      else {
        const { href: _ignored, ...rest } = link;
        preloads.push(rest);
      }
    }
    for (const dependency of chunk.imports ?? []) walk(dependency);
  };
  walk(key);
  return preloads ? { js, css, preloads } : { js, css };
}

/**
 * Extend a static Solid asset manifest with the remotes this server rendered.
 * The first module is the host's hydration module for that remote, which
 * Solid imports before hydrating the boundary that rendered it.
 */
export function withFederatedAssets<Manifest>(manifest: Manifest): Manifest {
  const state = federationSSRState();
  if (
    !state ||
    manifest === null ||
    typeof manifest !== 'object' ||
    typeof (manifest as { resolve?: unknown }).resolve === 'function'
  )
    return manifest;
  const modules = manifest as Record<string, unknown>;
  const resolve = (key: string): ResolvedDocumentAssets | null => {
    if (!key.startsWith(FEDERATED_ASSET_PREFIX))
      return resolveStaticAssets(modules, key);
    const assets = state.assets.get(key);
    if (!assets) return null;
    const id = key.slice(FEDERATED_ASSET_PREFIX.length);
    return {
      js: [
        joinAssetPath(
          modules._base,
          `${state.hydrationModule}?id=${encodeURIComponent(id)}`,
        ),
        ...assets.js,
      ],
      css: [...assets.css],
    };
  };
  return { resolve, resolveSync: resolve } as Manifest;
}
