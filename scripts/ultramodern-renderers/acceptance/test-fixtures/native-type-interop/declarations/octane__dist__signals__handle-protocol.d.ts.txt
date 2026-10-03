import { type SignalHandle, type WritableSignal } from './types.js';
/** Native handle capability checks must not import the graph or create an owner. */
export declare function isSignalHandle(value: unknown): value is SignalHandle<unknown>;
export declare function isWritableSignal(value: unknown): value is WritableSignal<unknown>;
