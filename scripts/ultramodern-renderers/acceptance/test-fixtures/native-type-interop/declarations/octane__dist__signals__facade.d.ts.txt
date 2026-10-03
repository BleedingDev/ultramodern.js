import { NATIVE_DOM_VALUE } from './read-protocol.js';
export { isSignalHandle, isWritableSignal } from './handle-protocol.js';
import { SIGNAL_HANDLE, SIGNAL_BINDING_IDENTITY, SIGNAL_BINDING_READ, SIGNAL_BINDING_SUBSCRIBE, SIGNAL_OWNER_RESOLVE, type DerivedCompute, type DerivedOptions, type DerivedSignal, type OwnerBoundSignal, type Scope, type ScopeSeed, type SignalHandle, type SignalOptions, type SignalOwner, type SignalOwnerIdentity, type SignalSnapshot, type WritableSignal } from './types.js';
import type { StreamFrameIdentity, StreamedSignalResultFrame } from '../streamed-signals-protocol.js';
/** @internal Install initial response data before this document creates any live cells. */
export declare function initializeDocumentSignalOwner(owner: SignalOwnerIdentity, seed: ScopeSeed): void;
/** @internal A document may freeze read work without retiring data or accepted writes. */
export declare function createSignalOwnerLifecycle(owner: SignalOwner): {
    readonly retired: boolean;
    freeze(): void;
    resume(): void;
    retire(): void;
};
/** @internal Resolve a public descriptor in the current declaration owner. */
export declare function resolveCurrentSignalHandle<T>(handle$: SignalHandle<T>): SignalHandle<T>;
/** @internal Resolve a descriptor against a captured renderer/request owner. */
export declare function resolveSignalHandleForOwner<T>(handle$: SignalHandle<T>, owner: SignalOwner): SignalHandle<T>;
/** @internal Resolve a descriptor against an already selected signal scope. */
export declare function resolveSignalHandleForScope<T>(handle$: SignalHandle<T>, owner: Scope): SignalHandle<T>;
/** @internal Shared owner resolution for statically selected signal factories. */
export declare abstract class Descriptor<T, H extends SignalHandle<T>> implements OwnerBoundSignal<T> {
    readonly key: string;
    readonly kind: H['kind'];
    private readonly create;
    private readonly site;
    readonly [SIGNAL_HANDLE]: true;
    private readonly cells;
    constructor(key: string, kind: H['kind'], create: (owner: Scope) => H, site: string | undefined);
    [SIGNAL_OWNER_RESOLVE](owner: Scope): H;
    private resolvedCell;
    protected resolve(): H;
    get(): T;
    [NATIVE_DOM_VALUE](): T;
    [SIGNAL_BINDING_READ](): T;
    [SIGNAL_BINDING_SUBSCRIBE](notify: () => void, onRetire?: () => void): () => void;
    [SIGNAL_BINDING_IDENTITY](): {
        scope: "document" | "instance";
        nodeKey: string;
    };
    latest(): T | undefined;
    latest<F>(fallback: F): T | F;
    snapshot(): SignalSnapshot<T>;
    subscribe(notify: () => void): () => void;
}
/** @internal Scalar and general derivations share the same public handle. */
export declare class DerivedDescriptor<T> extends Descriptor<T, DerivedSignal<T>> implements DerivedSignal<T> {
    readonly kind: 'derived';
}
/** @internal Preserve authored or compiler-assigned declaration identity. */
export declare function descriptorKey(site: string | undefined, explicit: string | undefined): string;
/** @internal Read authored identity once, without interpreting initial data as a key. */
export declare function signalOptionsKey(options?: SignalOptions): string | undefined;
export declare function __signalAt<T>(site: string | undefined, initial: T, options?: SignalOptions): WritableSignal<T>;
export declare function signal$<T>(initial: T, options?: SignalOptions): WritableSignal<T>;
/** Compiler-only scalar proof; authored derived$ remains dynamically asynchronous. */
export declare function __derivedScalarAt<T>(site: string | undefined, compute: DerivedCompute<T>, options?: DerivedOptions & SignalOptions): DerivedSignal<T>;
export declare function readSignalBinding<T>(handle$: SignalHandle<T>): T;
/** @internal Start compiler-proven independent reads without consuming their results. */
export declare function __startSignalReads(handles: readonly SignalHandle<unknown>[], primitive?: boolean): void;
/** Bind receiver-owned selection authority, optionally before the query descriptor resolves. */
export declare function bindStreamedSignalSelection(owner: SignalOwner, identity: StreamFrameIdentity): boolean;
/** Accept one already-validated result frame without reviving a retired owner. */
export declare function acceptStreamedSignalResult(owner: SignalOwner, frame: StreamedSignalResultFrame): boolean;
/** Fail one exact result channel without exposing an untrusted remote stack. */
export declare function failStreamedSignalResult(owner: SignalOwner, identity: StreamFrameIdentity, code: string): boolean;
interface StreamedSignalReceiver {
    attachResult(identity: StreamFrameIdentity, consumer: {
        accept(frame: StreamedSignalResultFrame): void | false;
        retainCompleted?(frames: StreamedSignalResultFrame[]): boolean;
        fail(error: any): void;
    }): () => void;
}
/** Connect a neutral early receiver to the signals engine without a hydration dependency. */
export declare function attachStreamedSignalResult(receiver: StreamedSignalReceiver, owner: SignalOwner, identity: StreamFrameIdentity): () => void;
