import { normalizeClass } from './class-names.js';
export { normalizeClass };
/**
 * Append a later class source onto an earlier one. Used when a synthesized
 * scope hash must share the element with a spread's class instead of replacing
 * it. Both sides go through `normalizeClass` so arrays / objects compose the
 * same way they would as a lone `class` value.
 */
export declare function mergeClass(left: unknown, right: unknown): string;
export declare function styleName(name: string): string;
/** @internal Development-only React-style inline CSS diagnostics. */
export declare function devWarnStyleProperty(name: string, value: unknown, server: boolean): void;
/** @internal Development-only guidance after an existing CSS coercion fails. */
export declare function devWarnStyleCoercion(name: string, value: unknown): void;
/**
 * The one stylesheet element-scoped `<ViewTransition>` needs. The client
 * dedupes the injection by this id and the SSR serializer emits the same pair,
 * so spelling either half twice ships the rule twice or drops it on one side.
 */
export declare const VIEW_TRANSITION_SCOPE_STYLE_ID = "octane-view-transition-scope";
export declare const VIEW_TRANSITION_SCOPE_CSS = "[vt-scope=\"element\"]{view-transition-scope:all!important}";
