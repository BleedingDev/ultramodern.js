/** The streamed protocol is opt-in; legacy devalue RPC remains unchanged. */
export declare const SERVER_RESULT_CONTENT_TYPE = "application/x-octane-rpc+ndjson";
export declare function encodeServerArguments(args: unknown[]): string;
export declare function decodeServerArguments(body: string): unknown[];
/** No authoritative receipt arrived; retrying a mutation could execute it twice. */
export declare class ServerCallUncertainError extends Error {
    readonly code = "OCTANE_RPC_UNCERTAIN";
    constructor(cause: unknown);
}
export interface ServerResultLimits {
    /** Maximum encoded bytes in one complete value or terminal frame. */
    maxFrameBytes?: number;
    /** Maximum bytes in this invocation, independently of the request-body limit. */
    maxTotalBytes?: number;
    /** Total invocation lifetime, including a stalled producer or consumer. */
    timeoutMs?: number;
}
export interface ServerCallBatchOptions extends ServerResultLimits {
    /** Explicitly asserts independent, finite reads; mutations/subscriptions stay outside. */
    kind: 'independent-reads';
    /** Local compatibility keys, not credentials sent to or trusted by the server. */
    authority: string;
    document: string;
}
export declare function validateServerCallBatch(options: ServerCallBatchOptions): void;
export interface ResolvedServerResultLimits {
    maxFrameBytes: number;
    maxTotalBytes: number;
    timeoutMs: number;
}
export declare function serverResultLimits(limits?: ServerResultLimits): ResolvedServerResultLimits;
export type ServerResultFrame = {
    kind: 'stream' | 'complete';
} | {
    kind: 'value';
    value: unknown;
} | {
    kind: 'error';
    error: string;
};
export declare function encodeServerResultFrame(sequence: number, frame: ServerResultFrame): Uint8Array;
export declare function decodeServerResultFrame(line: string, sequence: number): ServerResultFrame;
/**
 * Read one line at a time without concatenating the entire response or repeatedly
 * copying a growing partial frame. A transport chunk may contain several frames.
 */
export declare function serverResultReader(reader: ReadableStreamDefaultReader<Uint8Array>, limits: ResolvedServerResultLimits): () => Promise<ServerResultFrame>;
