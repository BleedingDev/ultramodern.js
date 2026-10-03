import type { ServerCallOptions } from './server-call.js';
import { type ServerCallBatchOptions, type ServerResultLimits } from './server-rpc-protocol.js';
export declare const SERVER_BATCH_CONTENT_TYPE = "application/x-octane-rpc-batch+ndjson";
export type { ServerCallBatchOptions } from './server-rpc-protocol.js';
export declare function batchServerCalls<T>(options: ServerCallBatchOptions, callback: () => T): T;
/** @internal Called only after local argument encoding and abort validation. */
export declare function enqueueServerCall(hash: string, body: string, options: ServerCallOptions, limits?: ServerResultLimits): Promise<unknown> | undefined;
