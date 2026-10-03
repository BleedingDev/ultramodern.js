import type { NativeReadWitness } from './native-read-collector.js';
import type { NativeReadInspection, NativeReadSource } from './read-protocol.js';
export interface NativeReadObservation {
    /** Null for a retry lease, which retains sources rather than an accepted snapshot. */
    readonly observedVersion: number | null;
    readonly currentVersion: number;
    readonly source: NativeReadInspection | null;
}
export interface NativeReadAttemptInspection {
    readonly mixed: boolean;
    readonly reads: readonly NativeReadObservation[];
}
export declare function inspectNativeReadSource(source: NativeReadSource, observedVersion: number | null): NativeReadObservation;
/** Copy metadata only; never evaluate a read, serialize a value, or subscribe. */
export declare function inspectNativeReadWitness(witness: NativeReadWitness): NativeReadAttemptInspection;
