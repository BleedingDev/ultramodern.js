export { applyHydrationControlCandidate, captureHydrationControlCandidate, consumeHydrationControl, snapshotHydrationControl, type HydrationControlCandidate, type HydrationControlCandidateValue, type HydrationControlSnapshot, } from './control-capture.js';
export { HYDRATE_SUPPORTED_INTERACTION_EVENTS } from './interaction-config.js';
/**
 * @internal Keep trusted focusing, touch activation, editing, and IME work on
 * the original event. Replaying an untrusted clone cannot restore those native
 * default actions; discrete activation events still need navigation guarded.
 */
export declare function shouldPreventHydrationInteractionDefault(event: Event): boolean;
export interface HydrationReplayIntent {
    event: Event;
    path: number[];
    /** @internal Optional native custody must remain valid until activation consumes it. */
    current?: () => boolean;
    /** An explicitly leased native listener receives the original event, never a replay. */
    earlyBinding?: true;
    /** Captured author opt-in; never inferred again from a later DOM version. */
    selection?: HydrationSelectionIntent;
}
interface HydrationSelectionIntent {
    control: Element;
    boundary: Element;
    group: string;
    sequence: number;
}
/** @internal A changed selection control cannot authorize an old click. */
export declare function isHydrationSelectionIntentCurrent(intent: HydrationReplayIntent): boolean;
/** @internal Replace only the immediately preceding captured selection. */
export declare function appendHydrationReplayIntent(queue: HydrationReplayIntent[], intent: HydrationReplayIntent): void;
export type HydrationIntentBoundaryStatus = 'hydrated' | 'never' | 'dormant' | 'handles';
export type HydrationIntentBoundary = (eventType: string, intent?: HydrationReplayIntent) => HydrationIntentBoundaryStatus;
/**
 * @internal Resolve an event target to an element-only path beneath a marker.
 * Renderer stream sentinels are omitted so the address survives their reveal.
 */
export declare function hydrationEventPathWithin(root: Element, target: EventTarget | null): number[] | null;
/** @internal Interpret the SSR strategy without invoking a registered boundary. */
export declare function hydrationMarkerInteractionStatus(marker: Element, eventType: string): HydrationIntentBoundaryStatus;
/** @internal Optional native ingress supplies its own captured authority. */
export declare function captureNativeHydrationIntent(marker: Element, event: Event, isCurrent: () => boolean): void;
/**
 * Install document-level capture for deferred-hydration interaction intent.
 * Calling this function more than once for the same document is a no-op.
 *
 * Applications that can receive input before `hydrateRoot()` should call this
 * from their lightweight client bootstrap. Mounting the first `<Hydrate>`
 * boundary also invokes it as a synchronous fallback.
 */
export declare function initializeHydrationEventCapture(ownerDocument?: Document): void;
/** @internal Enable independent ownership without adding hit tests to ordinary hydration. */
export declare function initializeIndependentHydrationEventCapture(ownerDocument: Document): void;
/** @internal Runtime bridge for a mounted deferred-hydration boundary. */
export declare function registerHydrationIntentBoundary(marker: Element, boundary: HydrationIntentBoundary): void;
/** @internal Runtime bridge for a removed deferred-hydration boundary. */
export declare function unregisterHydrationIntentBoundary(marker: Element, boundary: HydrationIntentBoundary): void;
/** @internal Consume intent captured before the runtime boundary was registered. */
export declare function takePendingHydrationIntents(marker: Element): HydrationReplayIntent[] | undefined;
/** @internal Native authority can expire while a marker or its module arrives. */
export declare function isNativeHydrationIntentCurrent(intent: HydrationReplayIntent): boolean;
/** @internal Consume conservative nested-dynamic intent recorded before registration. */
export declare function takeDelegatedDynamicHydrationIntent(marker: Element): boolean;
/** @internal Avoid duplicate handling by the boundary-local capture listener. */
export declare function wasEarlyHydrationIntentHandled(event: Event): boolean;
/** @internal Preserve nested dynamic intent discovered by a mounted parent. */
export declare function markDelegatedDynamicHydrationIntent(marker: Element): void;
