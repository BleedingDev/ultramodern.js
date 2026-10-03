import { type StreamedResultReceiver } from './stream-result-receiver.js';
type StreamedDeliveryReceiver = Pick<StreamedResultReceiver, 'receive' | 'failSelection'>;
/** Stable realm slot used by CSP-nonced server frame calls. */
export declare const STREAMED_RENDERER_RECEIVER = "__octaneStreamedRenderer";
export interface StreamedRendererGlobal {
    receive(frame: unknown): void;
}
export interface StreamedRendererDeliveryOptions {
    readonly maxFrameBytes?: number;
    /** Includes style/composition waits; also caps unfinished inline result channels. */
    readonly maxPendingFrames?: number;
    readonly maxPendingBytes?: number;
    /** Maximum queue/placement wait and result inactivity; readers also bound each pending read. */
    readonly timeoutMs?: number;
}
export interface StreamedRendererReadOptions extends StreamedRendererDeliveryOptions {
    readonly maxTotalBytes?: number;
    readonly signal?: AbortSignal;
}
/**
 * Install the pre-module frame entrypoint. A host calls this before any
 * renderer-owned frame script; replacing a receiver already owned by another
 * document is an error rather than a silent authority transfer.
 */
export declare function installStreamedRendererGlobal(receiver: StreamedDeliveryReceiver, target?: Record<string, unknown>, options?: StreamedRendererDeliveryOptions): () => void;
/**
 * Incrementally consume the same newline-delimited frame protocol used by the
 * initial document stream. A bounded cross-channel window permits independent
 * progress; a full window applies backpressure before accepting another frame.
 */
export declare function readStreamedRendererResponse(response: Response, receiver: StreamedDeliveryReceiver, options?: StreamedRendererReadOptions): Promise<void>;
export {};
