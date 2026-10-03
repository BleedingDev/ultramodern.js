import type { createReactiveSystem } from 'alien-signals/system';
import type { GraphOwner, ScopedNode, NodeState, SignalReadMode } from './graph.js';
import type { SignalActionFrame } from './transition-action.js';
import type { SignalTransitionCoordinatorFactory } from './transition-coordinator.js';
import { type NativeReadSource } from './read-protocol.js';
/** Shared state keeps model registration separate from optional native presentation. */
interface CandidateGraph {
    ScopedNode: typeof import('./graph.js').ScopedNode;
    graph: ReturnType<typeof createReactiveSystem>;
    flags: {
        Dirty: number;
        Mutable: number;
        Watching: number;
    };
    historical(): boolean;
    link(from: ScopedNode, to: ScopedNode): void;
    removeQueued(node: ScopedNode): void;
    assertAlive(owner: GraphOwner): void;
    strictValue<T>(state: NodeState<T>, key?: string): T;
    refreshNode<T>(node: ScopedNode<T>): NodeState<T>;
    pure<T>(read: () => T): T;
    untrack<T>(read: () => T): T;
    signalBatch<T>(read: () => T): T;
    publishNode<T>(node: ScopedNode<T>, state: NodeState<T>): void;
    readyState<T>(value: T): NodeState<T>;
    commitState(node: ScopedNode, state: NodeState): void;
    sameState(a: NodeState | undefined, b: NodeState): boolean;
    releaseRetainedOwners(node: ScopedNode): void;
    retainOwners(node: ScopedNode): void;
    releaseRetention(node: ScopedNode): void;
    createNativeSource(node: ScopedNode, mode: SignalReadMode): NativeReadSource;
    attachObserver(node: ScopedNode, notify: () => void, native: boolean): () => void;
}
/** Graph registration owns model transactions; native presentation remains optional. */
export declare let candidateGraph: CandidateGraph;
export declare function registerCandidateGraph(graph: CandidateGraph): void;
/** Live registration also admits signals loaded after an Action has awaited. */
export declare let createSignalActionFrame: (() => SignalActionFrame) | undefined;
export declare function registerSignalActionFrameFactory(factory: () => SignalActionFrame): void;
/** The renderer consults this live capability when its first native write occurs. */
export declare let createSignalTransitionCoordinator: SignalTransitionCoordinatorFactory | undefined;
export declare function registerSignalTransitionCoordinatorFactory(factory: SignalTransitionCoordinatorFactory): void;
export declare function withoutSignalCandidate<T>(callback: () => T): T;
/** Internal capability refusal, distinct from an authored TypeError. */
export declare class CandidateUnsupportedError extends TypeError {
}
export declare let activeCandidate: SignalActionFrame | undefined;
/** Synchronous action scope; never keep a candidate active across an await. */
export declare function swapActiveSignalCandidate(frame: SignalActionFrame | undefined): SignalActionFrame | undefined;
export declare let deferCandidateInvalidation: boolean;
export declare function swapCandidateInvalidation(defer: boolean): boolean;
export declare let candidateWriteCount: number;
export declare let candidateWriters: WeakMap<ScopedNode, Set<SignalActionFrame>> | undefined;
export declare function addCandidateWriter(node: ScopedNode, frame: SignalActionFrame): void;
export declare function removeCandidateWriter(node: ScopedNode, frame: SignalActionFrame): void;
export declare function recordCandidateUrgentWrite(node: ScopedNode, value: unknown): (() => void)[] | undefined;
export {};
