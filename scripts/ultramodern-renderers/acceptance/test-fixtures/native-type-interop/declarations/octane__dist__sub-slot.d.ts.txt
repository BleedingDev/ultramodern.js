/**
 * Formatting and identity options for binding-owned hook sub-slots.
 *
 * The defaults preserve the long-standing `parent:tag` global-symbol shape.
 * Bindings with an uncompiled-caller fallback can opt into a stable tag-only
 * symbol with `slotlessPrefix`; bindings that must distinguish two parent
 * symbols with the same description can set `global` to `false`.
 */
export interface SubSlotOptions {
    /** Text before the parent slot description. */
    parentPrefix?: string;
    /** Text between the parent slot description and the child tag. */
    tagPrefix?: string;
    /** Description used when a parent symbol has no description. */
    parentDescriptionFallback?: string;
    /** Text before a tag-only child; omitting it preserves an undefined parent. */
    slotlessPrefix?: string;
    /** Include the parent symbol's description in the child description. */
    includeParentDescription?: boolean;
    /** Use `Symbol.for`; set to false for factory-local child identities. */
    global?: boolean;
    /** Override global/local identity for tag-only children. */
    slotlessGlobal?: boolean;
}
export type SubSlot = (slot: symbol | undefined, tag: string) => symbol | undefined;
export type SlotlessSubSlot = (slot: symbol | undefined, tag: string) => symbol;
export declare function createSubSlot(options: SubSlotOptions & {
    slotlessPrefix: string;
}): SlotlessSubSlot;
export declare function createSubSlot(options?: SubSlotOptions): SubSlot;
/** Default binding helper: global `parent:tag` children and no slotless fallback. */
export declare const subSlot: SubSlot;
