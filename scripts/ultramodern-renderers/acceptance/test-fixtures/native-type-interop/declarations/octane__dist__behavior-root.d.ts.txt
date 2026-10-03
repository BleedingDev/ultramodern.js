export { adoptBindings, mountBindings, unbound } from './dom-bindings.js';
export type { BindingSource, BindingOptions, BindingHandle } from './dom-bindings.js';
export type { BindingRange, BindingMountTarget } from './dom-binding-program.js';
import type { CapturedFormSubmission } from './form-submission.js';
import type { FormSubmissionCapture } from './behavior-form-submissions.js';
export type { FormSubmissionCapture } from './behavior-form-submissions.js';
export { captureFormSubmissions } from './behavior-form-submissions.js';
export type { CapturedFormSubmission } from './form-submission.js';
/** A behavior-only root observes existing DOM without taking reconciliation ownership. */
export interface BehaviorRootOptions {
    /** Dispose this root when the enclosing page or document lifetime ends. */
    signal?: AbortSignal;
    /** Explicitly dispose an existing behavior root attached to this container. */
    replace?: boolean;
    /** Explicit synchronous parser-command ingress for this root. */
    formSubmissions?: FormSubmissionCapture;
}
export interface BehaviorDisposeOptions {
    /** Existing DOM is retained unless its removal is explicitly requested. */
    preserveDOM?: boolean;
}
export interface ExternalRangeOptions {
    /** Identity of the component, stream, or application owning this subtree. */
    owner: unknown;
    /** Delay adoption until the independently owned stream is ready. */
    ready?: PromiseLike<unknown>;
    signal?: AbortSignal;
    /** Explicitly hand the same subtree from its previous owner to this owner. */
    replace?: boolean;
}
export interface ExternalRange {
    readonly element: Element;
    readonly owner: unknown;
    readonly signal: AbortSignal;
    readonly ready: Promise<void>;
    dispose(): void;
}
export interface BehaviorContext {
    /** Per-element lifetime, canceled when its adoption or registration ends. */
    readonly signal: AbortSignal;
    /** The original native interaction when adoption was started by that event. */
    readonly event?: Event;
    /** The closest externally owned range, if this target belongs to one. */
    readonly range?: ExternalRange;
}
export type BehaviorCleanup = () => void;
export interface BehaviorEntry<Payload = unknown> {
    id?: string;
    target: string | Element;
    /** Restrict adoption to the closest range belonging to this exact owner. */
    owner?: unknown;
    events?: readonly string[];
    /**
     * Synchronously capture detached, immutable command arguments on the original
     * native event, before readiness or adoption. Register eagerly; this cannot
     * recover earlier values unless the form opted into parser-time submit capture.
     * Its third argument is the accepted snapshot for those native submissions.
     * May preventDefault(), but must not return live DOM/state or a promise.
     */
    captureEvent?(event: Event, element: Element, submission?: CapturedFormSubmission): Payload;
    ready?: PromiseLike<unknown>;
    dependencies?: readonly string[];
    conflicts?: readonly string[];
    signal?: AbortSignal;
    adopt(element: Element, context: BehaviorContext): void | BehaviorCleanup | PromiseLike<void | BehaviorCleanup>;
    handleEvent?(event: Event, element: Element, context: BehaviorContext, payload: Payload): void;
}
export interface BehaviorRegistration {
    readonly id?: string;
    readonly signal: AbortSignal;
    readonly ready: Promise<void>;
    dispose(): void;
}
export interface BehaviorRoot {
    readonly container: Element;
    readonly signal: AbortSignal;
    /** A snapshot of currently active ranges, registrations, and asynchronous adoptions. */
    readonly ready: Promise<void>;
    registerExternalRange(element: Element, options: ExternalRangeOptions): ExternalRange;
    registerBehavior<Payload = unknown>(entry: BehaviorEntry<Payload>): BehaviorRegistration;
    dispose(options?: BehaviorDisposeOptions): void;
}
/**
 * Attach behavior to existing DOM without rendering, replacing, or reconciling it.
 * Every owner, observer, listener, and constructor is scoped to the container's
 * own Document, including elements imported from another JavaScript realm.
 */
export declare function attachBehaviorRoot(container: Element, options?: BehaviorRootOptions): BehaviorRoot;
