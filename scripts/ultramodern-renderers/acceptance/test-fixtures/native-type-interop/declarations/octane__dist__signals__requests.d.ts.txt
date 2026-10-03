import { ScopedNode, type GraphOwner, type CandidateProducer, type NodeState } from './graph.js';
import { QUERY_REQUEST, skip, type Query, type QueryContext, type QueryRequest, type Resource, type Scope, type SignalSeedEntry } from './types.js';
import type { StreamFrameIdentity, StreamedSignalResultFrame } from '../streamed-signals-protocol.js';
import { type ServerSignalQueryAttemptObservations } from './query-attempt-observer.js';
export interface QueryDefinition {
    readonly key: string;
    readonly kind: 'promise' | 'stream';
    readonly load: (argument: any, context: QueryContext) => unknown;
}
/** The owner allocates each map on first use; streams exist only after ingress binds one. */
interface RequestOwner extends GraphOwner {
    requests: Map<string, RequestEntry> | undefined;
    queryDefinitions: Map<string, QueryDefinition> | undefined;
    readonly streams?: {
        readonly selections: Map<string, StreamFrameIdentity>;
        selectionReady(binding: ResourceBinding): void;
        discardCompleted(identity: StreamFrameIdentity): void;
    };
}
declare class Request<T> implements QueryRequest<T> {
    readonly definition: QueryDefinition;
    get [QUERY_REQUEST](): T;
    readonly queryKey: string;
    readonly identity: string;
    readonly argument: unknown;
    constructor(definition: QueryDefinition, argument: unknown);
}
export declare function query<A, T>(key: string, load: (argument: A, context: QueryContext) => T | PromiseLike<T>, options?: {
    kind?: 'promise';
}): Query<A, T>;
export declare function query<A, T>(key: string, load: (argument: A, context: QueryContext) => AsyncIterable<T> | PromiseLike<AsyncIterable<T>>, options: {
    kind: 'stream';
}): Query<A, T>;
/**
 * Create an eagerly selected, explicitly owned query resource. Keys are unique
 * within the scope; separate resources may share one canonical query request.
 * Native query$ declarations are the owner-optional authoring API.
 */
export declare function createResource<T>(owner: Scope, key: string, describe: () => QueryRequest<T> | typeof skip): Resource<T>;
interface Attempt {
    entry: RequestEntry | undefined;
    controller: AbortController | undefined;
    iterator: AsyncIterator<unknown> | undefined;
    readonly settled: Promise<void>;
    readonly generation: number;
    readonly streamed: boolean;
    result: unknown;
    observations: ServerSignalQueryAttemptObservations | undefined;
    sequence: number;
    resolve(): void;
    hasYielded: boolean;
}
export declare class RequestEntry {
    readonly owner: RequestOwner;
    readonly request: Request<unknown>;
    readonly consumers: Set<ResourceBinding<any>>;
    state: NodeState;
    attempt: Attempt | undefined;
    private generation;
    constructor(owner: RequestOwner, request: Request<unknown>, seed?: {
        entry: SignalSeedEntry;
        value: unknown;
    });
    get active(): boolean;
    get attemptGeneration(): number;
    observe(nodeKey: string): Attempt | undefined;
    start(pending: boolean): void;
    startStreamed(identity: StreamFrameIdentity): boolean;
    acceptStreamed(frame: StreamedSignalResultFrame): boolean;
    deliver(): void;
    stopAttempt(): void;
    remove(consumer: ResourceBinding): void;
}
export declare class ResourceBinding<T = any> {
    readonly owner: RequestOwner;
    readonly node: ScopedNode<T>;
    private describe;
    private candidate?;
    private selected;
    private selectedIdentity;
    private retainedRequest;
    private seeded;
    private describedAttempt;
    private observedAttempt;
    private pendingObserver;
    private pendingPromise;
    private resolvePending;
    private streamedSelection;
    private selectionAuthority;
    constructor(owner: RequestOwner, node: ScopedNode<T>, describe: (() => QueryRequest<T> | typeof skip) | undefined, seed?: {
        entry: SignalSeedEntry;
        value: unknown;
    }, retained?: {
        entry: SignalSeedEntry;
        value: unknown;
    } | undefined);
    private request;
    forkCandidate(target: ScopedNode<T>): CandidateProducer;
    private compute;
    private state;
    deliver(): void;
    private detach;
    private observeSelectedAttempt;
    get authority(): object | undefined;
    isStreamedSelectionReady(identity: StreamFrameIdentity): boolean;
    bindStreamedSelection(identity: StreamFrameIdentity): boolean;
    acceptStreamed(frame: StreamedSignalResultFrame): boolean;
    failStreamed(identity: StreamFrameIdentity, error: Error): boolean;
    retry(options?: {
        pending?: boolean;
    }): void;
    adopt(requestKey: string | undefined, value: T): boolean;
    seedRequest(retained?: boolean): SignalSeedEntry['request'];
    acceptsSeed(seed: SignalSeedEntry): boolean;
    dispose(): void;
}
export declare function initializeResource<T>(owner: RequestOwner, node: ScopedNode<T>, describe: () => QueryRequest<T> | typeof skip, seed?: {
    entry: SignalSeedEntry;
    value: unknown;
}, retained?: {
    entry: SignalSeedEntry;
    value: unknown;
} | undefined): ResourceBinding<T>;
export {};
