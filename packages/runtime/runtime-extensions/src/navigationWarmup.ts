type ChunkLoaderIdentity = object;

const realmNamespaces = new WeakMap<
  object,
  WeakMap<ChunkLoaderIdentity, Map<string, string>>
>();
let nextRealmNamespace = 0;

/**
 * Namespaces route warmups by the identities that give a chunk id meaning.
 * Weak maps ensure a retired app context or bundler runtime is not retained by
 * the shared prefetch cache. The public path is the final, value-based scope.
 */
export function getNavigationWarmupCacheKey(
  runtimeContext: object,
  chunkLoader: ChunkLoaderIdentity,
  publicPath: string,
  warmupKey: string,
): string {
  let loaderNamespaces = realmNamespaces.get(runtimeContext);
  if (loaderNamespaces === undefined) {
    loaderNamespaces = new WeakMap();
    realmNamespaces.set(runtimeContext, loaderNamespaces);
  }

  let publicPathNamespaces = loaderNamespaces.get(chunkLoader);
  if (publicPathNamespaces === undefined) {
    publicPathNamespaces = new Map();
    loaderNamespaces.set(chunkLoader, publicPathNamespaces);
  }

  let namespace = publicPathNamespaces.get(publicPath);
  if (namespace === undefined) {
    namespace = `realm-${++nextRealmNamespace}`;
    publicPathNamespaces.set(publicPath, namespace);
  }

  return `${namespace}:${warmupKey}`;
}
