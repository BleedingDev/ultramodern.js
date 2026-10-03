import type { ScopedNode, CandidateProducer, SignalReadMode } from './graph.js';
import { type NativeReadSource, type NativeTransitionConsumer } from './read-protocol.js';
export type CandidatePreparation = {
    status: 'ready';
    token: object;
    receipt: {
        publish(accepted?: () => void): boolean;
    };
} | {
    status: 'pending';
    token: object;
    wakeables: readonly PromiseLike<unknown>[];
} | {
    status: 'error';
    token: object;
    error: unknown;
} | {
    status: 'invalid';
    token: object;
    reason: 'stale' | 'unsupported';
};
export interface NativeCandidateSource {
    readonly source: NativeReadSource;
    accept(canonical: NativeReadSource, observedVersion: number): boolean;
    discard(): void;
}
interface NativeSignalActionExtension {
    source(entry: SignalActionNode, read: SignalReadMode, source: NativeReadSource): NativeReadSource;
    accept(prepared: readonly {
        entry: SignalActionNode;
        revision: number;
    }[]): void;
    release(entry: SignalActionNode): void;
}
/** Installed by an optional native presentation entry, never the graph engine. */
export declare function registerNativeSignalActionExtension(extension: NativeSignalActionExtension): void;
export interface SignalActionNode {
    readonly node: ScopedNode;
    readonly target: ScopedNode;
    revision: number;
    readonly epoch: number;
    readonly stop: () => void;
    producer?: CandidateProducer;
    written?: boolean;
    withdrawn?: boolean;
    urgentOperations?: Array<(previous: unknown) => unknown>;
    sources?: Partial<Record<SignalReadMode, NativeCandidateSource>>;
}
interface PreparationWake {
    notify?: (event: {
        kind: 'retry' | 'invalid';
        token: object;
    }) => void;
    validate?: () => boolean;
    token?: object;
    queued: boolean;
    invalid: boolean;
}
/**
 * Private model transaction. Both native presentation drivers and renderer-free
 * Actions preserve the same staged values, writer authority and publication receipt.
 */
export declare class SignalActionFrame {
    private entries;
    private originals;
    private generation;
    private active;
    private preparationToken;
    private preparationWatch;
    private demand;
    run<T>(callback: () => T): T;
    resolve<T>(node: ScopedNode<T>): ScopedNode<T>;
    write<T>(node: ScopedNode<T>, value: T | ((previous: T) => T)): void;
    /** Only observed candidates allocate forwarding sources; ordinary reads keep their identity. */
    nativeSource(target: ScopedNode, read: SignalReadMode, source: NativeReadSource): NativeReadSource;
    validate(): boolean;
    hasWrites(): boolean;
    /** Follow existing graph edges, never the document or a global consumer registry. */
    consumers(): readonly NativeTransitionConsumer[];
    /** Canonical memo witnesses cannot justify skipping a private forward read. */
    observes(node: ScopedNode): boolean;
    canonical<T>(node: ScopedNode<T>): ScopedNode<T>;
    /** Record intent without evaluating the forward graph in an urgent setter. */
    recordUrgentWrite(node: ScopedNode, value: unknown): (() => void) | undefined;
    private replaceWrite;
    private forgetWrite;
    /** Urgent writes win their own cells without restarting unaffected producer leases. */
    rebase(): void;
    prepare(reads?: readonly (() => unknown)[]): CandidatePreparation;
    watchPreparation(outcome: CandidatePreparation, notify: NonNullable<PreparationWake['notify']>): () => void;
    private invalidatePreparation;
    private pruneDemand;
    discard(): void;
    private release;
    private releaseEntry;
    private committed;
}
export {};
