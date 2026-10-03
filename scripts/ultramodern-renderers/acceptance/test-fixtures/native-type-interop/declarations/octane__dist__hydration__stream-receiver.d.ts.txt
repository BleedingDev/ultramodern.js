import { type StreamedRegionPlacementFrame, type StreamFrameIdentity } from '../streamed-signals-protocol.js';
import type { ScopeSeed } from '../signals/types.js';
import { type StreamedResultReceiver, type StreamedResultReceiverOptions as StreamedRegionReceiverOptions } from './stream-result-receiver.js';
export { StreamedReceiverError, type StreamedFrameDisposition, type StreamedResultReceiverOptions as StreamedRegionReceiverOptions, type StreamedResultConsumer, } from './stream-result-receiver.js';
export interface HistoricalFrameLease {
    release(): void;
}
export interface StreamedRegionRegistration {
    readonly identity: StreamFrameIdentity;
    readonly start: Comment;
    readonly end: Comment;
    readonly contentRevision: number;
    /** Re-read immediately before commit; active renderer ownership forbids HTML placement. */
    readonly isActive: () => boolean;
    /** Resolve compiler-proven styles. Completion means every identity is ready to paint. */
    readonly loadStyles: (styles: readonly string[]) => void | Promise<void>;
    /** Acquire the exact historical values that produced this candidate range. */
    readonly adoptHistoricalFrame: (frame: ScopeSeed) => HistoricalFrameLease;
    /** Renderer-specific stable-ID delta application; generic DOM morph/append is forbidden. */
    readonly applyDelta?: (frame: StreamedRegionPlacementFrame) => void;
}
export interface StreamedRegionReceiver extends StreamedResultReceiver {
    registerRegion(registration: StreamedRegionRegistration): () => void;
}
/** Accept streamed results and place registered renderer-owned HTML ranges. */
export declare function createStreamedRegionReceiver(options: StreamedRegionReceiverOptions): StreamedRegionReceiver;
