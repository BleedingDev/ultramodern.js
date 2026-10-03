import type { NativeReadWitness } from './native-read-collector.js';
/**
 * A failed first mount may be disposed before an abort-ignoring promise settles.
 * Its existing root or boundary retry episode retains only these source leases,
 * not the discarded component Scope or its output/effect closures.
 */
export declare function createNativeReadRetry(notify: () => void): {
    /** Retry leases have no accepted read revision and expose no values. */
    inspect(): import("./native-read-inspection.js").NativeReadObservation[];
    readonly generation: number;
    track(witness: NativeReadWitness): void;
    clear(): void;
};
export type NativeReadRetry = ReturnType<typeof createNativeReadRetry>;
