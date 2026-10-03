import { type ServerCallContext } from '../server-call.js';
import { type ServerResultLimits } from '../server-rpc-protocol.js';
/**
 * Execute a `module server` function for an RPC request. The wire format is
 * devalue on both sides (matching @ripple-ts/adapter's client stub, and chosen
 * over JSON so Dates/Maps/Sets/undefined/cycles round-trip): the request body
 * is a devalue-encoded argument array, the response a devalue-encoded
 * `{ value }` envelope. The metaframework loads this through the SSR module
 * graph (`ssrLoadModule('octane/server')`) so the executor and the resolved
 * server function share one runtime.
 */
export declare function executeServerFunction(fn: Function, body: string, context?: ServerCallContext): Promise<string>;
/** Opt-in result streaming; application authorization runs before this executor. */
export declare function executeServerFunctionStream(fn: Function, body: string, context?: ServerCallContext, limits?: ServerResultLimits): ReadableStream<Uint8Array>;
