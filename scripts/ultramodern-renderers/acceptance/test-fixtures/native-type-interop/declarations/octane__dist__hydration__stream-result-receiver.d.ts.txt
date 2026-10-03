import { type StreamedRegionPlacementFrame, type StreamedSignalResultFrame, type StreamFrameIdentity } from '../streamed-signals-protocol.js';
import type { HistoricalFrameLease, StreamedRegionRegistration } from './stream-receiver.js';
export interface StreamedResultConsumer {
    /** False defers this validated frame; reattaching the same consumer retries its bounded mailbox. */
    accept(frame: StreamedSignalResultFrame): void | false;
    /** True transfers this bounded completed mailbox to consumer-owned retention, without publishing it. */
    retainCompleted?(frames: StreamedSignalResultFrame[]): boolean;
    fail(error: StreamedReceiverError): void;
}
export interface StreamedResultReceiverOptions {
    readonly buildId: string;
    readonly documentId: string;
    readonly ownerKey: string;
    readonly maxPendingFrames?: number;
    readonly maxPendingBytes?: number;
    /** Maximum inactivity before the first result frame or between accepted result frames. */
    readonly pendingTimeoutMs?: number;
    readonly onError?: (error: StreamedReceiverError) => void;
}
export type StreamedFrameDisposition = 'accepted' | 'stale';
export declare class StreamedReceiverError extends Error {
    readonly code: 'identity' | 'sequence' | 'protocol' | 'overflow' | 'timeout' | 'terminal' | 'styles' | 'historical-frame' | 'placement';
    constructor(code: 'identity' | 'sequence' | 'protocol' | 'overflow' | 'timeout' | 'terminal' | 'styles' | 'historical-frame' | 'placement', message: string);
}
interface ResultState {
    sequence: number;
    opened: boolean;
    resource?: 'promise' | 'stream';
    values: number;
    terminal: boolean;
    frames: StreamedSignalResultFrame[];
    frameSizes: number[];
    bytes: number;
    consumer?: StreamedResultConsumer;
    timer?: ReturnType<typeof setTimeout>;
    failure?: StreamedReceiverError;
}
export interface StreamedSelectionState {
    identity: StreamFrameIdentity;
    result: ResultState;
    placementSequence: number;
    contentRevision: number;
    region?: StreamedRegionRegistration;
    historical?: HistoricalFrameLease;
    pendingPlacement?: {
        cancel(): void;
    };
    failure?: StreamedReceiverError;
}
export interface StreamedResultReceiver {
    registerSelection(identity: StreamFrameIdentity, contentRevision?: number): void;
    attachResult(identity: StreamFrameIdentity, consumer: StreamedResultConsumer): () => void;
    receive(frame: unknown): Promise<StreamedFrameDisposition>;
    receiveJson(json: string): Promise<StreamedFrameDisposition>;
    /** Fail only the exact current selection; false means stale or already failed. */
    failSelection(identity: StreamFrameIdentity, error: StreamedReceiverError): boolean;
    dispose(): void;
}
/**
 * Accept streamed results without HTML placement. Valid unregistered placement
 * frames still advance their sequence and return stale, as on the full receiver.
 */
export declare function createStreamedResultReceiver(options: StreamedResultReceiverOptions): StreamedResultReceiver;
/**
 * Internal static seam: the full receiver supplies DOM placement while both
 * variants retain the same selection, result, failure and cleanup authority.
 */
export declare function createStreamedResultReceiverState(options: StreamedResultReceiverOptions, commitPlacement?: (state: StreamedSelectionState, frame: StreamedRegionPlacementFrame, isCurrent: (state: StreamedSelectionState, identity: StreamFrameIdentity) => boolean) => Promise<StreamedFrameDisposition>): {
    receiver: StreamedResultReceiver;
    current: (identity: StreamFrameIdentity) => StreamedSelectionState | undefined;
};
export {};
