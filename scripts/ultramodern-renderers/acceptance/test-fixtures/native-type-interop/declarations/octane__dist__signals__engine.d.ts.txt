import { type ScopeStreams } from './scope-streams.js';
import { ScopedNode, endSignalBatch, startSignalBatch, type GraphOwner, type CandidateProducer, type NodeState, type SignalObserver, type SignalReadMode, type SignalCandidateFrame } from './graph.js';
import { type NativeSerializedScope } from './read-protocol.js';
import type { initializeResource, QueryDefinition, RequestEntry, ResourceBinding } from './requests.js';
import type { StreamFrameIdentity, StreamedSignalResultFrame } from '../streamed-signals-protocol.js';
import type { AdoptionFrame, DerivedSignal, DerivedCompute, DerivedOptions, QueryRequest, Resource, Scope, ScopeInspection, ScopeOptions, ScopeSeed, skip, SignalHandle, SignalSeedEntry, SignalTraceEvent, WritableSignal } from './types.js';
interface DecodedSeedEntry {
    readonly entry: SignalSeedEntry;
    readonly value: unknown;
}
/** Owner lifecycle shared by scalar and asynchronous declaration implementations. */
export interface DerivedBindingLifecycle {
    suspend(): boolean;
    resume(): void;
    dispose(): void;
    forkCandidate?(target: ScopedNode, frame: SignalCandidateFrame): CandidateProducer | undefined;
}
type DerivedBindingFactory<T> = new (owner: ScopeImpl, node: ScopedNode<T>, compute: DerivedCompute<T>, options?: DerivedOptions) => DerivedBindingLifecycle;
interface FrameData {
    readonly owner: ScopeImpl;
    readonly entries: Map<string, DecodedSeedEntry>;
    references: number;
}
export declare class ScopeImpl implements Scope, GraphOwner {
    private readonly key;
    readonly seedable: boolean;
    readonly nodes: Map<string, ScopedNode<any>>;
    readonly observers: Set<SignalObserver>;
    requests: Map<string, RequestEntry> | undefined;
    queryDefinitions: Map<string, QueryDefinition> | undefined;
    resources: Map<ScopedNode, ResourceBinding> | undefined;
    streams: ScopeStreams | undefined;
    derivedBindings: Map<ScopedNode, DerivedBindingLifecycle> | undefined;
    frames: Set<AdoptionFrameImpl> | undefined;
    private readonly seedEntries;
    private readonly traceLimit;
    private events;
    private sequence;
    private lifetime;
    private disposed;
    readBarrier: Promise<void> | undefined;
    /** Internal document lifecycle: mark every owner before cancellation runs user code. */
    suspendReads(): void;
    resumeReads(): void;
    constructor(key: string, options: ScopeOptions, seedable?: boolean);
    get scopeKey(): string;
    get epoch(): number;
    get retired(): boolean;
    private createNode;
    private declaredNode;
    private initialSeed;
    private retainedSeed;
    private initializeRetention;
    private consumeSeed;
    signal$<T>(key: string, initial: T): WritableSignal<T>;
    createSignalDeclaration<T>(key: string, initial: T, preferInitial?: boolean): WritableSignal<T>;
    derived$<T>(key: string, compute: (() => T) & (T extends PromiseLike<unknown> ? never : unknown)): DerivedSignal<T>;
    /** Candidate state is private; the ordinary node/binding maps stay untouched. */
    forkCandidate(node: ScopedNode, target: ScopedNode, frame: SignalCandidateFrame): CandidateProducer | undefined;
    createDerivedDeclaration<T>(key: string, compute: DerivedCompute<T>, options: DerivedOptions | undefined, Binding: DerivedBindingFactory<T>): DerivedSignal<T>;
    createResourceDeclaration<T>(key: string, describe: () => QueryRequest<T> | typeof skip, initialize: typeof initializeResource, unique?: boolean): Resource<T>;
    private own;
    get<T>(handle$: SignalHandle<T>): T;
    set<T>(handle$: WritableSignal<T>, value: T | ((previous: T) => T)): void;
    isPending(read: () => unknown): boolean;
    batch<T>(write: () => T): T;
    action<F extends (...args: any[]) => any>(write: F): F;
    seedEntry(node: ScopedNode, read?: SignalReadMode): SignalSeedEntry | undefined;
    serialize(): ScopeSeed;
    /** Serialize an observed ready subgraph, without evaluating anything new. */
    serializeRead(root: ScopedNode, read: SignalReadMode): readonly NativeSerializedScope[] | undefined;
    beginAdoption(seed: ScopeSeed): AdoptionFrame;
    trace(type: SignalTraceEvent['type'], node?: ScopedNode): void;
    inspect(): ScopeInspection;
    dispose(): void;
}
declare class AdoptionFrameImpl implements AdoptionFrame {
    readonly data: FrameData;
    private ended;
    private readonly sources;
    private readonly subscribers;
    constructor(data: FrameData);
    get scopeKey(): string;
    get released(): boolean;
    private assertActive;
    run<T>(read: () => T): T;
    retain(): AdoptionFrame;
    read(node: ScopedNode, read: SignalReadMode): NodeState;
    release(): void;
}
export declare function createScope(options: ScopeOptions): Scope;
/** Only the native hook adapter may create a component-owned, non-serializable scope. */
export declare function createLocalScope(scopeKey: string): Scope;
export declare function createDeclaredSignalCell<T>(owner: Scope, key: string, initial: T, preferInitial?: boolean): WritableSignal<T>;
export declare function createDerivedCellWith<T>(owner: Scope, key: string, compute: DerivedCompute<T>, options: DerivedOptions | undefined, Binding: DerivedBindingFactory<T>): DerivedSignal<T>;
export declare function createResourceCellWith<T>(owner: Scope, key: string, describe: () => QueryRequest<T> | typeof skip, initialize: typeof initializeResource, unique?: boolean): Resource<T>;
export declare function adoptResourceValue<T>(handle$: SignalHandle<T>, requestKey: string | undefined, value: T): boolean;
/** @internal Return the concrete owner for a proven runtime handle. */
export declare function getSignalScope(handle$: SignalHandle<unknown>): Scope | undefined;
/** @internal Exact selection generation used to pin an optimistic query write. */
export declare function getResourceSelectionAuthority(handle$: SignalHandle<unknown>): object | undefined;
/**
 * @internal Bind receiver-owned selection authority before result delivery.
 * This is the only ingress that creates a scope's stream capability.
 */
export declare function bindScopeStreamedSelection(owner: Scope, identity: StreamFrameIdentity): boolean;
/** @internal Publish a receiver-validated result into an exact current request. */
export declare function acceptScopeStreamedResult(owner: Scope, frame: StreamedSignalResultFrame): boolean;
/** @internal Fail one exact streamed attempt after receiver timeout or rejection. */
export declare function failScopeStreamedResult(owner: Scope, identity: StreamFrameIdentity, error: Error): boolean;
export { startSignalBatch, endSignalBatch };
