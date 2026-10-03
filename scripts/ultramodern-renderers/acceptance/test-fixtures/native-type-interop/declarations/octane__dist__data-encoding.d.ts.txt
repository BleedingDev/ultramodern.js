import type { EncodedSignalValue } from './signals/types.js';
export declare function encodeSignalValue(value: unknown, ancestors?: Set<object>): EncodedSignalValue;
/**
 * Take an immutable plain-data snapshot without an encode/decode round trip.
 * Keep this traversal separate so encode-only consumers retain neither its code
 * nor a per-value mode branch. Both paths enforce the same input descriptor rules.
 */
export declare function snapshotSignalValue(value: unknown, ancestors?: Set<object>): unknown;
export declare function decodeSignalValue(encoded: EncodedSignalValue): unknown;
