/**
 * Type surface for the shared TSRX transform's host-spread helpers.
 *
 * The volar `typeOnly` virtual TSX rewrites host-element spreads as
 * `__normalize_spread_props(...)` / `__normalize_spread_props_for_ref_attr(...)`
 * and imports both from the platform's `imports.refProp` module — pointing that
 * at THIS subpath makes the names resolve with useful types from every octane
 * consumer. The real compile emits its own spread handling and never imports
 * this module. Preserve each authored prop's type, while allowing the virtual
 * TSX to read an absent spread ref as undefined when composing it with an
 * explicit ref attribute.
 */
export declare function normalize_spread_props<T>(props: T): T;
type SpreadPropsWithRef<T> = T extends {} ? T & {
    ref?: 'ref' extends keyof T ? T['ref'] : undefined;
} : T extends null | undefined ? never : T;
export declare function normalize_spread_props_for_ref_attr<T>(props: T): SpreadPropsWithRef<T>;
export {};
