/** Sentinel <template> attribute marking a pending streamed boundary. */
export declare const STREAM_BOUNDARY_ATTR = "data-oct-b";
/** Renderer-owned JSON script carrying resolved SSR Suspense values. */
export declare const SUSPENSE_SCRIPT_ATTR = "data-octane-suspense";
/** Renderer-owned executable/data scripts emitted by the streaming protocol. */
export declare const STREAM_SCRIPT_ATTR = "data-octane-stream";
/** Render-unique token stamped on deferred-hydration owners in a streamed shell. */
export declare const HYDRATE_STREAM_TOKEN_ATTR = "data-octane-stream-token";
/** Find a physical hydration range's close without trusting malformed comment input. */
export declare function rendererRangeClose(open: Node | null): Comment | null;
/** Existing physical list boundary and marker values for an owned SSR host. */
export interface HydrationListRange {
    readonly start: Comment;
    readonly end: Comment;
    readonly emptyMarker: string;
    readonly itemsMarker: string;
}
/** Resolve a leading list without searching later content or granting ownership. */
export declare function getLeadingHydrationListRange(host: Element): HydrationListRange | null;
/** True for the opaque per-render token minted by the server streamer. */
export declare function isRendererStreamToken(token: string | null): token is string;
/** Extract the render token from a canonical streamed-boundary id. */
export declare function streamTokenFromBoundaryId(id: string | null): string | null;
/**
 * Recognize a renderer sentinel only when its opaque id belongs to the expected
 * stream and it occupies the exact leading position of a balanced SSR range.
 */
export declare function isRendererStreamBoundaryTemplate(node: Element, expectedToken?: string | null): boolean;
