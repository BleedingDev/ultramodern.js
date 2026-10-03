import { type BindingValue } from './dom-bindings.js';
import type { BindingSignalConnection } from './dom-binding-signals.js';
import { type NativeReadSource, type NativeTransitionPresentation } from './signals/read-protocol.js';
/** Acquire prospective graph leases before releasing any published subscription. */
export declare function __prepareBindingSources(reads: Map<NativeReadSource, number>, subscriptions: Map<NativeReadSource, () => void>, notify: () => void, active: () => boolean, run: <T>(callback: () => T) => T): NativeTransitionPresentation;
/** Canonical style values after native handles and CSS units have been resolved. */
export type BindingStyleSnapshot = Readonly<Record<string, string | null>>;
/** Shared preparation keeps native style projections on the canonical CSS rules. */
export declare function __normalizeBindingStyle(value: unknown): BindingValue;
/**
 * Query-selected whole-style capability. Native source subscriptions belong to
 * this binding lifetime; the existing graph and canonical style reader own all
 * signal semantics. Fixed-property artifacts never import this module.
 */
export declare function __createBindingStyles(): {
    connect(node: Element, notify: () => void, restoreStyles?: boolean): BindingSignalConnection;
};
