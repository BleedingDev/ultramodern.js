export type BindingKey = string | number;
/** Payload prefix opening a presentation-binding range. */
export declare const BINDING_OPEN_PREFIX: string;
/**
 * Comment payload opening an authored presentation view's own component range.
 * The client runtime and the SSR serializer both stamp this onto the view they
 * bind, so the two must never spell it separately.
 */
export declare function bindingRootMarker(id: string): string;
export declare function encodeBindingKey(key: BindingKey): string;
export declare function decodeBindingKey(encoded: string): BindingKey;
export interface BindingMarker {
    id: string;
    site: string;
    kind: 'root' | 'if' | 'for' | 'item' | 'text' | 'view' | 'slot' | 'opaque';
    arm?: number;
    key?: string;
}
export declare function parseBindingMarker(data: string): BindingMarker | null;
export declare function isBindingOpenComment(data: string): boolean;
/**
 * True when a binding-open payload carries an `@for` outer arm. The prefix test
 * alone is not a decision: `isBindingOpenComment` still requires the full
 * receipt, so this only spares callers from spelling the arm prefixes again.
 */
export declare function isForBindingOpenComment(data: string): boolean;
