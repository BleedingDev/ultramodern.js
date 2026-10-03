import { type StreamedRendererFrame, type StreamedSignalResultFrame, type StreamFrameIdentity } from '../streamed-signals-protocol.js';
import type { StreamInjectionSource } from '../runtime.server.js';
import type { ServerSignalQueryAttempt } from '../signals/query-attempt-observer.js';
export interface StreamedRendererLimits {
    readonly maxFrameBytes?: number;
    readonly maxTotalBytes?: number;
    /** Maximum wait for producer progress; queued data and sink backpressure pause it. */
    readonly timeoutMs?: number;
}
export interface StreamedSignalResultOptions extends StreamedRendererLimits {
    readonly signal?: AbortSignal;
    /** Re-enter the captured server request owner for lazy iterator pulls. */
    readonly run?: <T>(callback: () => T) => T;
    /** @internal Initial-document authority announcement before result frames. */
    readonly announceSelection?: boolean;
}
export interface AutomaticStreamedSignalOptions extends StreamedRendererLimits {
    readonly buildId: string;
    readonly documentId: string;
    readonly selectionGeneration?: number;
    readonly nonce?: string;
}
export interface AutomaticStreamedSignalInjection extends StreamInjectionSource {
    observeSignalAttempt(attempt: ServerSignalQueryAttempt, run?: <T>(callback: () => T) => T): void;
}
/** Produce the authoritative result-channel grammar without exposing server errors. */
export declare function createStreamedSignalResultFrames(identity: StreamFrameIdentity, result: unknown, options?: Pick<StreamedSignalResultOptions, 'signal' | 'run'>): AsyncGenerator<StreamedSignalResultFrame>;
/** Demand-driven newline-delimited transport for later fetched SSR regions/results. */
export declare function createStreamedRendererFrameStream(frames: AsyncIterable<StreamedRendererFrame>, options?: StreamedRendererLimits & {
    signal?: AbortSignal;
}): ReadableStream<Uint8Array>;
/** Serialize one validated frame for an already-installed pre-module receiver. */
export declare function streamedRendererFrameScript(frame: StreamedRendererFrame, nonce?: string): string;
/**
 * Adapt one signal result to renderTo*Stream's external injection channel.
 * The producer advances only after the renderer confirms the prior injected
 * script reached its transport sink.
 */
export declare function createStreamedSignalInjection(identity: StreamFrameIdentity, result: unknown, options?: StreamedSignalResultOptions & {
    nonce?: string;
}): StreamInjectionSource;
/**
 * Multiplex every query attempt discovered by one SSR render into the same
 * backpressure-aware pre-module result channel.
 */
export declare function createAutomaticStreamedSignalInjection(options: AutomaticStreamedSignalOptions, external?: StreamInjectionSource): AutomaticStreamedSignalInjection;
