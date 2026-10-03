import { type NativeTransitionPresentation } from './signals/read-protocol.js';
import { type SignalHandle } from './signals/types.js';
export interface BindingSignalConnection {
    /** Resolve and observe a projected handle, or disconnect for an ordinary value. */
    read(value: unknown): unknown;
    /** Read only the already connected channel; never reevaluate the authored projection. */
    get(): unknown;
    /** Prepare a different projection without replacing the currently published lease. */
    preview(value: unknown): BindingPreparedValue;
    /** Optional whole-style writer, present only on the selected style capability. */
    write?(value: unknown): void;
    dispose(preservePresentation?: boolean): void;
}
export interface BindingPreparedValue<T = unknown> extends NativeTransitionPresentation {
    readonly value: T;
}
/** @internal Imported accessors must not silently turn live reads into source snapshots. */
export declare function __assertBindingSnapshot<T>(read: () => T): T;
/** @internal Query-selected capability; captures the existing owner, never creates a graph. */
export declare function __createBindingSignals(): {
    isSignal: (value: unknown) => value is SignalHandle<unknown>;
    connect(notify: () => void): BindingSignalConnection;
};
