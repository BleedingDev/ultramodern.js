import type { RendererIdentity } from '../identity';
import type { DocumentAsset, RequestSession } from '../session';

/** Native route matching remains with the selected router adapter. */
export interface NativeServerConfig {
  readonly ssr?: boolean | 'stream';
  readonly forceCSR?: boolean;
  readonly ssrByRouteIds?: readonly string[];
}

export interface NativeRequestContext<Bindings extends object = object> {
  readonly session: RequestSession<Bindings>;
  readonly assets?: readonly DocumentAsset[];
  readonly nonce?: string;
  /** Opaque compiler-owned JSON. The native adapter validates its own ABI. */
  readonly nativeManifest?: unknown;
  readonly serverConfig?: NativeServerConfig;
  readonly entry: Readonly<RendererIdentity>;
}

export type NativeRequestHandler<Bindings extends object = object> = (
  request: Request,
  context: NativeRequestContext<Bindings>,
) => Response | Promise<Response>;

/** Identity is generated with the bundle, never inferred from its filename. */
export interface NativeServerManifest<Bindings extends object = object> {
  readonly rendererIdentity: RendererIdentity;
  readonly nativeRequestHandler: NativeRequestHandler<Bindings>;
  readonly nativeCSRRequestHandler?: NativeRequestHandler<Bindings>;
  readonly nativeMatchRouteIds?: (
    request: Request,
    context: NativeRequestContext<Bindings>,
  ) => readonly string[] | Promise<readonly string[]>;
}

export interface CachedNativeDocument {
  readonly identityKey: string;
  readonly expiresAt: number;
  readonly status: 200;
  readonly statusText: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly bytes: Uint8Array;
}

/** All calls receive an identity-namespaced key, including custom stores. */
export interface NativeDocumentCache {
  get(
    key: string,
  ):
    | CachedNativeDocument
    | undefined
    | Promise<CachedNativeDocument | undefined>;
  set(key: string, value: CachedNativeDocument): void | Promise<void>;
}

export interface NativeDispatchOptions<Bindings extends object = object> {
  readonly identity: RendererIdentity;
  readonly loadManifest: () =>
    | NativeServerManifest<Bindings>
    | Promise<NativeServerManifest<Bindings>>;
  readonly context: Omit<
    NativeRequestContext<Bindings>,
    'session' | 'entry'
  > & {
    readonly bindings: Bindings;
  };
  readonly cache?: NativeDocumentCache;
  readonly maxCacheBytes?: number;
  /** Native hydration ABI build, distinct from the source/profile identity. */
  readonly hydrationBuildId?: string;
  /** Node hosts confirm complete delivery and return the final wire headers. */
  readonly confirmDelivery?: (
    response: Response,
  ) => Promise<Headers | undefined>;
  readonly onCacheError?: (error: unknown) => void;
  readonly onError?: (
    error: unknown,
    request: Request,
    context: NativeRequestContext<Bindings>,
  ) => Response | Promise<Response>;
}
