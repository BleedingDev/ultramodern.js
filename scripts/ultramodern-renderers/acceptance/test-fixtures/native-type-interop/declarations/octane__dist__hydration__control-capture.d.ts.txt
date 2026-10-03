/** @internal Shared inline mailbox record; its activation queue has one owner. */
export type EarlyHydrationIntent = readonly [
    Event,
    Element,
    Element,
    string,
    string | null,
    string | null,
    Element?,
    string?,
    boolean?,
    number?
];
/** @internal Captured control state and activation require the same DOM authority. */
export declare function isEarlyHydrationIntentCurrent([event, target, boundary, id, when, events, , , formSubmission]: EarlyHydrationIntent, ownerDocument: Document): boolean;
export interface HydrationControlSnapshot {
    /** Advances for every captured input, including a clear-to-empty-string edit. */
    readonly editRevision: number;
    /** Advances independently when the platform reports a selection change. */
    readonly selectionRevision: number;
    /** Advances for edits, selection, focus, and composition changes. */
    readonly revision: number;
    readonly value: string;
    readonly checked?: boolean;
    readonly selectedValues?: readonly string[];
    readonly selectionStart: number | null;
    readonly selectionEnd: number | null;
    readonly selectionDirection: 'forward' | 'backward' | 'none' | null;
    readonly focused: boolean;
    readonly composing: boolean;
}
/** Opaque revision token captured before an asynchronous local restoration read. */
export interface HydrationControlCandidate {
    readonly control: Element;
    readonly bindingId: string | null;
    readonly boundaryId: string | null;
    readonly snapshot: HydrationControlSnapshot;
}
export interface HydrationControlCandidateValue {
    readonly value?: string;
    readonly checked?: boolean;
    readonly selectedValues?: readonly string[];
}
/**
 * @internal Snapshot the live platform state used by an island's atomic input
 * handoff. The current DOM is authoritative; the counters only decide whether
 * the state changed while ownership was being transferred.
 */
export declare function snapshotHydrationControl(control: Element): HydrationControlSnapshot | null;
/** @internal Only unchanged server state may yield to an eventless textarea restore. */
export declare function isRestoredHydrationTextarea(control: Element, value: unknown): boolean;
/**
 * Capture the exact DOM/edit authority an async storage read is allowed to replace.
 * A focus, selection, composition, input (including clear), node replacement, or
 * boundary rebinding before apply makes the candidate stale.
 */
export declare function captureHydrationControlCandidate(control: Element): HydrationControlCandidate | null;
/** Apply one local candidate only while the captured DOM revision still owns the value. */
export declare function applyHydrationControlCandidate(candidate: HydrationControlCandidate, value: HydrationControlCandidateValue): boolean;
/** @internal Retire only the exact early state an activating owner adopted. */
export declare function consumeHydrationControl(control: Element, revision: number): boolean;
/**
 * @internal Own only native control state. Island activation remains optional:
 * leave its mailbox intact so a later full bootstrap can claim every intent.
 */
export declare function initializeHydrationControlCapture(ownerDocument?: Document): void;
