import type { ServerCallOptions } from './server-call.js';
import { type ServerResultLimits } from './server-rpc-protocol.js';
/**
 * Compiler target for browser calls to a `module server` export.
 * @internal
 */
export declare function __serverRpc(hash: string, args: unknown[], options?: ServerCallOptions, stream?: boolean, limits?: ServerResultLimits): Promise<unknown>;
