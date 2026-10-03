import type { EncodedSignalValue, ScopeSeed } from './signals/types.js';
/** Independent resource/HTML channel identity. Arrival order is never freshness. */
export interface StreamFrameIdentity {
    readonly protocol: 1;
    readonly buildId: string;
    readonly documentId: string;
    readonly ownerKey: string;
    readonly instanceKey: string;
    readonly nodeKey: string;
    readonly selectionKey: string;
    readonly selectionGeneration: number;
    readonly attempt: number;
}
interface StreamFrameBase {
    readonly identity: StreamFrameIdentity;
    /** Monotone within one identity and logical channel, beginning at zero. */
    readonly sequence: number;
}
export type StreamedSignalResultFrame = StreamFrameBase & ({
    readonly channel: 'result';
    readonly kind: 'open';
    readonly resource: 'promise' | 'stream';
} | {
    readonly channel: 'result';
    readonly kind: 'value';
    readonly value: EncodedSignalValue;
} | {
    readonly channel: 'result';
    readonly kind: 'complete';
} | {
    readonly channel: 'result';
    readonly kind: 'error';
    readonly code: string;
});
export type StreamedRegionPlacementFrame = StreamFrameBase & {
    readonly channel: 'placement';
    readonly kind: 'html';
    /** Authoritative monotone revision for the currently selected source. */
    readonly contentRevision: number;
    /** A delta is legal only against this exact already-presented revision. */
    readonly baseRevision?: number;
    readonly mode: 'full' | 'delta';
    /** Renderer-owned artifact. Applications do not pass arbitrary HTML here. */
    readonly html: string;
    /** Exact values read to produce this range, independent of newer live values. */
    readonly historicalFrame: ScopeSeed;
    /** Compiler/bundler style identities that must be ready before reveal. */
    readonly styles: readonly string[];
};
export type StreamedRendererFrame = StreamedSignalResultFrame | StreamedRegionPlacementFrame;
export declare function isStreamFrameIdentity(value: unknown): value is StreamFrameIdentity;
/** Strictly validate an untrusted decoded frame before any mailbox or DOM mutation. */
export declare function isStreamedRendererFrame(value: unknown): value is StreamedRendererFrame;
export declare function decodeStreamedRendererFrame(json: string): StreamedRendererFrame;
/** Escape a validated frame for a nonced inline receiver call; never evaluate it as source. */
export declare function encodeStreamedRendererFrameForScript(frame: StreamedRendererFrame): string;
export declare function sameStreamFrameIdentity(a: StreamFrameIdentity, b: StreamFrameIdentity): boolean;
/** Stable local map key only; authority still requires field-by-field comparison. */
export declare function streamFrameIdentityKey(identity: StreamFrameIdentity): string;
export {};
