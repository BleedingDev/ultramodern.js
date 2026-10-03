/** Trusted, request-local capabilities. None of these fields are RPC arguments. */
export interface ServerCallContext<Viewer = unknown> {
    readonly request: Request;
    readonly signal: AbortSignal;
    readonly viewer: Viewer;
    readonly platform?: unknown;
}
/** Local caller options; the compiler never serializes these into RPC arguments. */
export interface ServerCallOptions {
    signal?: AbortSignal;
}
export interface ServerFunctionTarget {
    readonly id: string;
    readonly module: string;
    readonly export: string;
}
/** The host must authorize each invocation inside its own async request store. */
export interface ServerCallHost {
    invoke<T>(target: ServerFunctionTarget, options: ServerCallOptions, execute: (context: ServerCallContext) => T): T | Promise<T>;
}
export interface ServerCallContextSource {
    getStore(): ServerCallHost | undefined;
}
type CallerArguments<Args extends unknown[]> = Args extends [...infer Input, unknown] ? [...Input, options?: ServerCallOptions] : never;
export type ServerFunction<Fn extends (...args: any[]) => any> = (...args: CallerArguments<Parameters<Fn>>) => Promise<Awaited<ReturnType<Fn>>>;
export declare class InvalidServerFunctionPayloadError extends Error {
    readonly code = "OCTANE_INVALID_RPC_PAYLOAD";
    constructor(cause?: unknown);
}
/** @internal Host integration; the source contains no process-global request value. */
export declare function __setServerCallContextSource(source: ServerCallContextSource): void;
/** @internal Compiler target for exports with a final ServerCallContext parameter. */
export declare function __registerServerFunction<Fn extends (...args: any[]) => any>(fn: Fn, contextIndex: number, target: ServerFunctionTarget): ServerFunction<Fn>;
/**
 * @internal Call a registered export in-process with the same per-invocation
 * authorization as RPC. Returning/aliasing the export retains this wrapper.
 */
export declare function __serverCall(fn: (...args: any[]) => unknown, args: unknown[], options?: ServerCallOptions): Promise<unknown>;
/** @internal Used only after the host has authorized this particular invocation. */
export declare function invokeServerFunction(fn: Function, args: unknown[], context?: ServerCallContext): unknown;
export {};
