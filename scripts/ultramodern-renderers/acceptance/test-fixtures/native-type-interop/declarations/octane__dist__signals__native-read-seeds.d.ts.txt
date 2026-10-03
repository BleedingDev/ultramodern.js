import type { AdoptionFrame, ScopeSeed } from './types.js';
import type { NativeReadWitness } from './native-read-collector.js';
import type { NativeAdoptionOwner, NativeReadSource } from './read-protocol.js';
export declare const NATIVE_SIGNAL_SEED_ATTR = "data-octane-native-signals";
/** A server arm with untransportable demand is mounted fresh within its own range. */
export declare const NATIVE_SIGNAL_FRESH_COMMENT = "oct-native-fresh:";
export interface NativeSignalReference {
    readonly key: string;
    /** Strict value reads are explicit here, unlike their omission in a ScopeSeed. */
    readonly read: 'value' | 'latest' | 'snapshot';
}
/** Version 2 references only the initial document entries used by this HTML. */
export type NativeSignalManifest = {
    readonly version: 1;
    readonly scopes: readonly ScopeSeed[];
} | {
    readonly version: 2;
    readonly scopes: readonly ScopeSeed[];
    readonly initialDocument: {
        readonly scopeKey: string;
        readonly entries: readonly NativeSignalReference[];
    };
};
/** Take ownership of wire data without reading getters or retaining mutable input. */
export declare function captureInitialDocumentSignals(seed: ScopeSeed, scopeKey: string): ScopeSeed;
export interface NativeSeedReads {
    readonly reads: Map<NativeReadSource, number>;
    mixed: boolean;
}
export declare function mergeNativeSeedReads(previous: NativeSeedReads | null, next: NativeReadWitness): NativeSeedReads;
/** Read maps append and never replace their first revision, so a suffix can rewind. */
export declare function rewindNativeSeedReads(reads: NativeSeedReads | null, size: number, mixed: boolean): void;
/** Serialize the values that produced accepted HTML, without reading live getters. */
export declare function serializeNativeSeedReads(reads: NativeReadWitness | null, initialDocumentSignals?: ScopeSeed): NativeSignalManifest | undefined;
export declare function parseNativeSignalManifest(raw: string): NativeSignalManifest;
/** Materialize this boundary's history, never the document's unreferenced values. */
export declare function materializeNativeSignalManifest(manifest: NativeSignalManifest, initialDocumentSignals?: ScopeSeed): Extract<NativeSignalManifest, {
    readonly version: 1;
}>;
/**
 * One existing root/boundary adoption owns this state. Frames are acquired only
 * for data scopes actually read, keyed by exact owner identity. Nothing looks
 * up or retains live data scopes in a global registry.
 */
export declare function createNativeAdoptionState(manifest: NativeSignalManifest, initialDocumentSignals?: ScopeSeed): {
    resolve(owner: NativeAdoptionOwner): AdoptionFrame | undefined;
    release(): void;
};
export type NativeAdoptionState = ReturnType<typeof createNativeAdoptionState>;
