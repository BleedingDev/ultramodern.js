import type { ScopedNode } from './graph.js';
import { type StreamFrameIdentity, type StreamedSignalResultFrame } from '../streamed-signals-protocol.js';
import type { ScopeImpl } from './engine.js';
import type { ResourceBinding } from './requests.js';
/**
 * Receiver-owned streamed results for one scope. Only the stream ingress
 * functions create this capability, so an owner that never binds a streamed
 * selection allocates none of its maps and retains none of this code.
 *
 * The owner still drives its lifecycle: document suspension expires unfinished
 * channels, resumption rebinds refreshed resources, and disposal clears every
 * channel after the owner is marked retired.
 */
export declare class ScopeStreams {
    private readonly owner;
    readonly selections: Map<string, StreamFrameIdentity>;
    private readonly results;
    private readonly failures;
    private readonly waiting;
    constructor(owner: ScopeImpl);
    /** Mark every unfinished channel expired before cancellation runs user code. */
    suspend(): void;
    /** A refreshed resource may bind the selection that survived suspension. */
    resume(node: ScopedNode, binding: ResourceBinding): void;
    clear(): void;
    bind(identity: StreamFrameIdentity, node: ScopedNode | undefined): boolean;
    isPending(identity: StreamFrameIdentity): boolean;
    whenReady(identity: StreamFrameIdentity, ready: () => void): () => void;
    selectionReady(binding: ResourceBinding): void;
    retainCompleted(identity: StreamFrameIdentity, frames: StreamedSignalResultFrame[]): boolean;
    discardCompleted(identity: StreamFrameIdentity): void;
    accept(frame: StreamedSignalResultFrame): boolean;
    fail(identity: StreamFrameIdentity, error: Error): boolean;
    /** Deliver results that arrived before their resource declaration executed. */
    flush(node: ScopedNode, binding: ResourceBinding): void;
}
export declare function scopeStreams(owner: ScopeImpl): ScopeStreams;
