import type { RenderResult } from '../runtime.server.js';
import type { ScopeSeed } from '../signals/types.js';
import { type StreamFrameIdentity, type StreamedRegionPlacementFrame } from '../streamed-signals-protocol.js';
export interface StreamedRegionPlacementOptions {
    /** Resolve compact renderer history into the standalone placement frame. */
    readonly initialDocumentSignals?: ScopeSeed;
    readonly sequence: number;
    readonly contentRevision: number;
    /** Completed-build stylesheet URLs; the receiver waits for them before reveal. */
    readonly styles?: readonly string[];
}
/**
 * Package a completed renderer snapshot for an explicitly registered dormant
 * region. Render under the region's request owner; never reuse cached response
 * HTML with a different document, owner, or selection envelope. Cache source
 * data instead. The current protocol admits one data owner per region.
 */
export declare function createStreamedRegionPlacementFrame(identity: StreamFrameIdentity, rendered: RenderResult, options: StreamedRegionPlacementOptions): StreamedRegionPlacementFrame;
