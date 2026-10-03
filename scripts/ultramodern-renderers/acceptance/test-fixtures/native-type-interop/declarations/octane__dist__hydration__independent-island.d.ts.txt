import type { ScopeSeed, SignalOwner } from '../signals/types.js';
import { type IndependentHydrateManifest } from '../independent-hydration-protocol.js';
import { type HydrationReplayIntent } from './event-capture.js';
export interface IndependentHydrateActivationContext {
    readonly element: Element;
    readonly manifest: IndependentHydrateManifest;
    readonly captures: readonly unknown[];
    readonly intents: readonly HydrationReplayIntent[];
    readonly signalOwner?: SignalOwner;
    /** Initial document history shared with the matching server renderer. */
    readonly initialDocumentSignals?: ScopeSeed;
}
export type IndependentHydrateActivator = (context: IndependentHydrateActivationContext) => void | {
    unmount(): void;
} | Promise<void | {
    unmount(): void;
}>;
export interface IndependentHydrateRegistration {
    readonly load: () => Promise<Record<string, unknown>>;
    readonly loadStyles: (styles: readonly string[]) => void | Promise<void>;
    readonly signalOwner?: SignalOwner;
    /** Initial document history shared with the matching server renderer. */
    readonly initialDocumentSignals?: ScopeSeed;
    readonly onError?: (error: unknown) => void;
}
export interface IndependentHydrateBootstrapOptions {
    /** Executing client build authority, not a value adopted from a sidecar. */
    readonly buildId?: string;
    readonly loadModule: (moduleId: string) => Promise<Record<string, unknown>>;
    readonly loadStyles: (styles: readonly string[]) => void | Promise<void>;
    readonly signalOwner?: SignalOwner;
    /** Initial document history shared with the matching server renderer. */
    readonly initialDocumentSignals?: ScopeSeed;
    readonly onError?: (error: unknown) => void;
}
export interface IndependentHydrateLifecycle {
    (): void;
    pause(): void;
    resume(): void;
}
/**
 * Register one compiler/bundler-proven island with the pre-root intent capture.
 * Loading this island never evaluates its lexical parent or a sibling module.
 */
export declare function registerIndependentHydrationIsland(element: Element, manifest: IndependentHydrateManifest, registration: IndependentHydrateRegistration): IndependentHydrateLifecycle;
/**
 * Register every inert SSR sidecar before a parent root can claim its DOM.
 * Module resolution is host-owned so a bundler can map exact emitted chunk IDs
 * without retaining the lexical parent module.
 */
export declare function bootstrapIndependentHydration(root: ParentNode, options: IndependentHydrateBootstrapOptions): IndependentHydrateLifecycle;
