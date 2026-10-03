import type { NativeTransitionPresentation } from './read-protocol.js';
import type { SignalActionFrame } from './transition-action.js';
/** Concrete host objects stay typed without making the model import a renderer. */
export interface SignalTransitionTypes {
    Block: SignalTransitionBlock<this>;
    Owner: SignalTransitionOwner<this>;
    Transaction: SignalTransitionTransaction<this>;
    Attempt: SignalTransitionAttempt<this>;
    Update: SignalTransitionUpdate<this>;
    Hook: SignalTransitionHook<this>;
    Batch: SignalTransitionBatch<this>;
    Boundary: SignalTransitionBoundary<this>;
    Thenable: PromiseLike<unknown>;
    Suspense: SignalTransitionSuspense<this>;
    Capture: object;
    RootFrame: object;
    MemoSwap: object;
    Value: unknown;
}
interface SignalTransitionAttempt<T extends SignalTransitionTypes> {
    memoSwaps: T['MemoSwap'][] | null;
}
interface SignalTransitionHook<T extends SignalTransitionTypes> {
    block: T['Block'];
    pendingBatches: number;
    isPending: boolean;
}
interface SignalTransitionSuspense<T extends SignalTransitionTypes> {
    readonly thenable: T['Thenable'];
}
interface SignalTransitionBlock<T extends SignalTransitionTypes> {
    disposed: boolean;
    parentBlock: T['Block'] | null;
    idState: {
        renderOwner?: T['Owner'];
    };
    pendingMode: 'urgent' | 'transition' | null;
    inactive: boolean;
}
interface SignalTransitionOwner<T extends SignalTransitionTypes> {
    disposed: boolean;
    transaction: T['Transaction'] | null;
    nativeTransitions?: Set<T['Batch']>;
}
interface SignalTransitionTransaction<T extends SignalTransitionTypes> {
    owner: T['Owner'];
    capture: T['Capture'];
    retired: Set<T['Block']> | null;
    aborted: boolean;
    nativeAdmitted?: boolean;
}
interface SignalTransitionUpdate<T extends SignalTransitionTypes> {
    block: T['Block'];
    slot: {
        value: T['Value'];
        pendingActionBatch?: T['Batch'];
        pendingActionValue?: T['Value'];
    };
    state?: {
        renderTransition?: T['Update'];
        updates?: unknown;
    };
    reducer?: {
        renderTransition?: T['Update'];
        renderPhaseActions?: unknown;
    };
}
interface SignalTransitionBatch<T extends SignalTransitionTypes> {
    updates: Map<object, T['Update']>;
    flushed: boolean;
    hook: T['Hook'] | null;
    hooks: T['Hook'][] | null;
    hooksPending: boolean;
    native?: SignalActionFrame;
    nativeWake?: () => void;
    nativeBlocks?: Set<T['Block']>;
    nativeBoundaries?: Map<T['Boundary'], T['Thenable']>;
}
interface SignalTransitionBoundary<T extends SignalTransitionTypes> {
    tryBlock: T['Block'] | null;
    parentBlock: T['Block'];
    nativeTransition?: T['Batch'];
    transitionTimeoutId: ReturnType<typeof setTimeout> | null;
    hasResolved: boolean;
    branch: -1 | 0 | 1 | 2;
    pendingBody: object | null;
}
export interface NativeTransitionAttempt<T extends SignalTransitionTypes> {
    blocks: Set<T['Block']>;
    transactions: Set<T['Transaction']>;
    attempts: T['Attempt'][];
    presentations: NativeTransitionPresentation[];
    suspensions: Map<T['Boundary'], T['Thenable']>;
    errorBlock?: T['Block'];
}
/** The optional coordinator reuses the renderer's journals and commit wave. */
export interface SignalTransitionRuntime<T extends SignalTransitionTypes> {
    attempt: NativeTransitionAttempt<T> | null;
    readonly visibility: {
        find(block: T['Block'], climbResolved: boolean): T['Boundary'] | null;
        reveal(boundary: T['Boundary'], mode: 'urgent' | 'transition'): void;
        hidePending(boundary: T['Boundary']): void;
    } | null;
    readonly rollback: boolean;
    readonly fallbackTimeout: number;
    schedule(): void;
    beginRoot(owner: T['Owner'] | undefined): T['RootFrame'] | null;
    endRoot(frame: T['RootFrame'] | null): void;
    beginAttempt(block: T['Block']): T['Attempt'] | null;
    endAttempt(attempt: T['Attempt'] | null): void;
    invalidate(block: T['Block'], owner: T['Block']): void;
    render(block: T['Block']): void;
    journal(value: object): void;
    journalProperty(value: object, key: PropertyKey, previous: unknown): void;
    isSuspense(error: unknown): error is T['Suspense'];
    releaseHookHolder(holder: object): void;
    rebaseUpdate(update: T['Update']): T['Value'];
    flushBatch(batch: T['Batch']): void;
    currentPresentations(capture: T['Capture']): boolean;
    validateCapture(capture: T['Capture']): boolean;
    acceptCapture(capture: T['Capture'], owner: T['Owner'], replayRefs: boolean): boolean;
    commitRoots(): void;
    rollbackRoot(transaction: T['Transaction']): void;
    applyMemoSwap(swap: T['MemoSwap'], forward: boolean): void;
    handleError(block: T['Block'], error: unknown): void;
    reportError(error: unknown, hook?: T['Hook']): void;
    unsupportedError(): TypeError;
}
export interface SignalTransitionCoordinator<T extends SignalTransitionTypes> {
    queue(batch: T['Batch']): void;
    flush(): void;
    prepare(block: T['Block']): void;
    retire(block: T['Block']): void;
    hasWork(): boolean;
}
export type SignalTransitionCoordinatorFactory = <T extends SignalTransitionTypes>(runtime: SignalTransitionRuntime<T>) => SignalTransitionCoordinator<T>;
/** Registered by the model entry, with no runtime import or ordinary-render allocation. */
export declare function createSignalTransitionCoordinator<T extends SignalTransitionTypes>(runtime: SignalTransitionRuntime<T>): SignalTransitionCoordinator<T>;
export {};
