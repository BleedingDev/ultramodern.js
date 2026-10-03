import { BINDING_HANDOFF } from './signals/control-handoff.js';
export { BINDING_HANDOFF };
/** Current early-owned range, not a license to render a different shape. */
export interface BindingHandoffRange {
    readonly kind: 'if' | 'view' | 'slot' | 'text';
    readonly end: Node;
    readonly arm?: number;
    readonly view?: string;
    readonly slot?: string;
}
/** A closed caller shape proven for this actual child range, never for its module globally. */
export interface BindingHandoffView {
    readonly id: string;
    readonly closedProps: readonly string[];
}
export interface BindingHandoffRest {
    readonly id: string;
    readonly node: number;
    readonly spread: number;
    readonly keys: readonly string[];
}
export interface BindingHandoff {
    readonly id: string;
    readonly root: Node;
    readonly anchor: Node;
    readonly end?: Node;
    /** A scalar host's declared native channels; descendants belong to other owners. */
    readonly host?: ReadonlySet<string>;
    /** Revisioned presentations return -1 while publication is in progress. */
    revision?(): number;
    ranges?(): ReadonlyMap<Node, BindingHandoffRange>;
    view?(root: Node): BindingHandoffView | undefined;
    rest?(element: Element, site: number): BindingHandoffRest | undefined;
    valid?(): boolean;
    /** One deferred retry; listener storage is allocated only when requested. */
    afterPublication?(callback: () => void): () => void;
    active(): boolean;
    retire(publish?: () => void): void;
    owner?: object;
}
export interface BindingHandoffCapability {
    [BINDING_HANDOFF](): BindingHandoff;
}
/** @internal Reuse the adapter's native listener lifetime; no renderer dependency. */
export declare function registerBindingEvent(node: Node, type: string): () => void;
/** @internal Called only by a host explicitly acquiring bindingLeases. */
export declare function claimBindingHandoff(lease: BindingHandoff, owner: object): void;
/** @internal Releasing a pending claim does not dispose the early presentation. */
export declare function releaseBindingHandoff(lease: BindingHandoff): void;
/** @internal Native adapters work before the host imports its renderer. */
export declare function hasBindingHandoffEvent(event: Event): boolean;
/** @internal A synchronous takeover must not redeliver the original native command. */
export declare function markBindingEvent(event: Event, node: Node, capture: boolean): void;
/** @internal Consume only this node/phase, preserving unrelated ancestor handlers. */
export declare function consumeBindingEvent(event: Event, node: Node, capture: boolean): boolean;
/** @internal The renderer's outermost native capture observer starts each dispatch. */
export declare function beginBindingEvent(event: Event): void;
