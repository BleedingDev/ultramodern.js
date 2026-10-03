export declare class ScopeDisposedError extends Error {
    constructor(scopeKey: string);
}
export declare class SignalWriteError extends Error {
    constructor();
}
export declare class SignalCycleError extends Error {
    constructor(key: string);
}
export declare class SignalIdleError extends Error {
    constructor(key: string);
}
export declare class SignalFrameError extends Error {
    constructor(message: string);
}
export declare class SignalStreamError extends Error {
    readonly code: string;
    constructor(code: string);
}
export declare class SignalSerializationError extends Error {
    constructor(message: string);
}
