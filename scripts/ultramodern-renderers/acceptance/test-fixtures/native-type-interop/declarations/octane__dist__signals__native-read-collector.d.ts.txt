import { type NativeReadSource } from './read-protocol.js';
/** Compiler-owned evidence for one automatically cached computation. */
export interface NativeReadWitness {
    readonly reads: ReadonlyMap<NativeReadSource, number>;
    readonly mixed: boolean;
}
/**
 * Synchronous compiler scopes and memo witnesses are shared by both renderers.
 * A scope is an existing renderer owner, never a new reactive ownership tree.
 * Reusable stack cells keep empty compiled bodies allocation-free after their
 * first nesting depth; read maps exist only for actual native reads.
 */
export declare function createNativeReadCollector(onRead: (owner: object, source: NativeReadSource, version: number) => void): {
    isDetached(): boolean;
    beginScope(next: object): number;
    endScope(token: number): void;
    /** Own parameters, the component body, and returned-output normalization. */
    beginRender(next?: object | null): number;
    endRender(token: number): void;
    /** A child Block cannot accidentally add its reads to its parent. */
    suspend(allowWrites?: boolean): number;
    resume(token: number, allowWrites?: boolean): void;
    beginWitness(detached?: boolean): number;
    finishWitness(token: number, completed: boolean): NativeReadWitness | null;
    replay(witness: NativeReadWitness | null | undefined): void;
};
export declare function validateNativeReadWitness(witness: NativeReadWitness | null | undefined): boolean;
