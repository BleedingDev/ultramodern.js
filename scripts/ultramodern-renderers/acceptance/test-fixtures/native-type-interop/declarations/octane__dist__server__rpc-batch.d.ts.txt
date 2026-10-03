import { type ServerCallBatchOptions, type ServerResultLimits } from '../server-rpc-protocol.js';
export type { ServerCallBatchOptions } from '../server-rpc-protocol.js';
/** In-process calls keep their per-call authorization; there is no HTTP batch to collect. */
export declare function batchServerCalls<T>(options: ServerCallBatchOptions, callback: () => T): T;
export interface ServerBatchMember {
    id: number;
    hash: string;
    body: string;
}
/**
 * Finite independent reads only. Each member crosses the ordinary authorized
 * request boundary. Multi-yield subscriptions use their own demand-driven RPC.
 * At most 32 bounded single values can be ready; no unbounded per-channel queue.
 */
export declare function executeServerFunctionBatch(body: string, invoke: (member: ServerBatchMember, signal: AbortSignal) => Promise<Response>, options?: ServerResultLimits & {
    signal?: AbortSignal;
}): ReadableStream<Uint8Array>;
