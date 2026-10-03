import { type SignalControlBinding } from './control-handoff.js';
import { type SignalHandle, type SignalOwner } from './types.js';
type SignalControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type ControlChannel = 'value' | 'checked';
export interface BindingControlPrepared {
    /** Publish captured native edits and switch input authority, without writing DOM. */
    publish(): void;
    /** Commit only a still-current, fully validated native value. */
    commit(): void;
}
export interface BindingControlPreview extends BindingControlPrepared {
    validate(): boolean;
    discard(): void;
}
export interface BindingControlLease {
    prepare(value: unknown): BindingControlPrepared;
    preview(value: unknown): BindingControlPreview;
    prepareCurrent(): BindingControlPrepared;
    active(): boolean;
    composing(): boolean;
    dispose(): void;
}
/** @internal Optional compiled-control capability; captures, but never creates, an owner. */
export declare function __createBindingControls(owner?: SignalOwner | null): {
    claim(element: Element, channel: ControlChannel, notify: () => void): BindingControlLease;
};
/**
 * Bind one native property on externally owned DOM without creating a renderer.
 * Writable signals adopt captured early edits and receive native input; other
 * handles only project. The callable cleanup may be offered to hydrateRoot in
 * controlLeases; declined or suspended presentation keeps this binding active.
 */
export declare function bindSignalControl(control: SignalControl, channel: 'value', handle$: SignalHandle<string | readonly string[]>): SignalControlBinding;
export declare function bindSignalControl(control: HTMLInputElement, channel: 'checked', handle$: SignalHandle<boolean>): SignalControlBinding;
export {};
