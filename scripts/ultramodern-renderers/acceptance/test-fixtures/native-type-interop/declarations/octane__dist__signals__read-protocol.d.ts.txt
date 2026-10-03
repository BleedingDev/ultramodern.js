import type { AdoptionFrame, ConnectionState, ScopeSeed, SignalHandle } from './types.js';
import type { SignalCandidateFrame } from './transition-candidate.js';
import type { ScopedNode } from './graph.js';
/** Explicit async reads own an observer edge instead of a synchronous graph edge. */
export declare const SIGNAL_DEPENDENT_NODE: unique symbol;
export type SignalDependencyNotify = (() => void) & {
    [SIGNAL_DEPENDENT_NODE]?: ScopedNode;
};
/** Only presentation subscriptions participate; public subscribers are never replayed. */
export declare const NATIVE_TRANSITION_CONSUMER: unique symbol;
export interface NativeTransitionConsumer {
    active(): boolean;
    prepare(): void | NativeTransitionPresentation;
}
/** Prepared host work stays private until every participating presentation is ready. */
export interface NativeTransitionPresentation {
    validate(): boolean;
    commit(): void;
    discard(): void;
}
export type NativeTransitionNotify = (() => void) & {
    [NATIVE_TRANSITION_CONSUMER]?: NativeTransitionConsumer;
};
/** Preserve presentation identity when an owner or lifetime wraps a subscription. */
export declare function forwardNativeTransitionConsumer<T extends () => void>(notify: NativeTransitionNotify, wrapped: T): T;
/** Lazy renderer registration survives a reentrant synchronous input scope. */
export declare function registerNativeActionResolver(resolver: () => SignalCandidateFrame | undefined): void;
export declare function getNativeCandidate(): SignalCandidateFrame | undefined;
/** Restore before yielding; null suppresses even a newly registered Action resolver. */
export declare function setNativeCandidateResolver(resolver: (() => SignalCandidateFrame | undefined) | null | undefined): typeof resolver;
/** Detached DevTools metadata. Reading it must never evaluate or expose a value. */
export interface NativeReadInspection {
    readonly scopeKey: string;
    readonly key: string;
    readonly read: 'value' | 'latest' | 'snapshot';
    readonly kind: 'signal' | 'derived' | 'async';
    readonly status: 'idle' | 'ready' | 'pending' | 'error' | 'unevaluated';
    readonly revision: number;
    readonly generation?: number;
    readonly epoch: number;
    readonly retired: boolean;
    readonly historical: boolean;
    readonly retained: boolean;
    readonly refreshing: boolean;
    readonly connection: ConnectionState;
    readonly complete: boolean;
    readonly dependencies: readonly {
        readonly scopeKey: string;
        readonly key: string;
    }[];
}
/**
 * The engine reports native reads through this renderer-free channel. Keeping
 * the channel separate from either runtime lets the engine run without DOM or
 * server dependencies, and lets compiled native readers select their renderer.
 */
export interface NativeReadSource {
    /**
     * A conservative invalidation revision. Reading it must not evaluate user
     * computations. A historical source reports its lease revision independently
     * of the live source whose value was captured.
     */
    getVersion(): number;
    /** Subscribe without evaluating a user computation. */
    subscribe(notify: () => void): () => void;
    /** Ready values from the observed revision, without running computations. */
    serialize?(observedVersion: number): readonly NativeSerializedScope[] | undefined;
    /** On-demand metadata for a currently referenced source, with no global graph registry. */
    inspect?(): NativeReadInspection;
}
export type NativeReadObserver = (source: NativeReadSource, version: number) => void;
/** Private protocol implemented on native handles, never inferred from a get method. */
export declare const NATIVE_DOM_VALUE: unique symbol;
export declare function readNativeDomValue<T>(value: T): T extends SignalHandle<infer V> ? V : T;
/** Snapshot values so later writes can diff against the last applied style. */
export declare function readNativeDomStyle(value: any): any;
export declare function readNativeDomProps(props: Record<string, unknown>): Record<string, unknown>;
/** A renderer supplies historical data only for a data scope actually read. */
export interface NativeAdoptionOwner {
    readonly scopeKey: string;
    beginAdoption(seed: ScopeSeed): AdoptionFrame;
}
/** Exact ownership accompanies renderer serialization but is never sent on the wire. */
export interface NativeSerializedScope {
    readonly owner: NativeAdoptionOwner;
    readonly seed: ScopeSeed;
}
export type NativeAdoptionResolver = (owner: NativeAdoptionOwner) => AdoptionFrame | undefined;
/** Internal hydration control flow, never an application error-boundary value. */
export declare class NativeAdoptionMiss extends Error {
    readonly scopeKey: string;
    readonly nodeKey: string;
    readonly read: 'value' | 'latest' | 'snapshot';
    constructor(scopeKey: string, nodeKey: string, read?: 'value' | 'latest' | 'snapshot');
}
export declare function getNativeAdoptionResolver(): NativeAdoptionResolver | null;
/** The caller restores the previous resolver in a synchronous finally block. */
export declare function setNativeAdoptionResolver(resolver: NativeAdoptionResolver | null): NativeAdoptionResolver | null;
export interface NativeBatchHooks {
    startBatch(): void;
    endBatch(): void;
}
/** Engine registration does not make either renderer import the graph package. */
export declare function registerNativeBatchHooks(hooks: NativeBatchHooks): void;
/** Return the exact engine pair so nested registration cannot unbalance a batch. */
export declare function beginNativeBatch(): NativeBatchHooks | null;
export declare function endNativeBatch(hooks: NativeBatchHooks | null): void;
export declare function runNativeBatch<T>(callback: () => T): T;
/** Report the revision actually read, including reads that subsequently throw. */
export declare function reportNativeRead(source: NativeReadSource, version: number): void;
export declare function getNativeReadObserver(): NativeReadObserver | null;
/** The caller restores the returned observer in a synchronous finally block. */
export declare function setNativeReadObserver(observer: NativeReadObserver | null): NativeReadObserver | null;
/**
 * Render/adoption purity is independent of dependency collection. Disabling
 * collection for a loader or snapshot must not permit it to write during a
 * render. Like the read observer, this guard must never span an async gap.
 */
export declare function beginNativeWriteGuard(): boolean;
export declare function endNativeWriteGuard(previous: boolean): void;
export declare function isNativeWriteGuarded(): boolean;
