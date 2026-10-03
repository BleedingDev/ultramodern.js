import type { SignalHandle } from './types.js';
/** Renderer-independent capability shared by early views and later presentation. */
export declare const BINDING_HANDOFF: unique symbol;
/** Explicit, renderer-independent ownership of one standalone native control. */
export declare const CONTROL_HANDOFF: unique symbol;
/** @internal One claim registry for writable and readonly native control leases. */
export declare const CONTROL_BINDINGS: WeakMap<Element, Set<"value" | "checked">>;
/** @internal Readonly projections also own the property, even without an input writer. */
export declare function hasSignalControlBinding(control: Element, channel: 'value' | 'checked'): boolean;
/** @internal A root may consume this capability only with its accepted presentation. */
export interface ControlHandoff {
    readonly control: Element;
    readonly channel: 'value' | 'checked';
    active(): boolean;
    /** Called within the prospective renderer's signal owner, without changing authority. */
    matches(handle: SignalHandle<unknown>): boolean;
    composing(): boolean;
    retire(): void;
    owner?: object;
}
/** Callable cleanup which can also be offered explicitly to hydrateRoot's controlLeases. */
export interface SignalControlBinding {
    (): void;
    /** @internal Merely requesting the capability never transfers the control. */
    [CONTROL_HANDOFF](): ControlHandoff;
}
