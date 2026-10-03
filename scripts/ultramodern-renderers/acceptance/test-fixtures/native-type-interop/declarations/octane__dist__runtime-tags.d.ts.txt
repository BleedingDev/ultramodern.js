/**
 * Cross-realm value-kind tags. Every one of these is a `Symbol.for` registry
 * key, which makes the STRING the contract: the client runtime, the SSR
 * serializer, the universal core, and the React compat layers all recognize a
 * value by looking its tag up in the same global registry. A typo in any one of
 * them mints a different symbol and silently fails every `$$kind` identity
 * check that module performs, so each key is spelled exactly once, here.
 *
 * This leaf has no imports on purpose: a consumer that needs one tag must not
 * pull in the DOM tables or the renderer graph to get it.
 */
/** `createElement` descriptor marker. */
export declare const ELEMENT_TAG: unique symbol;
/** `createPortal` descriptor marker. */
export declare const PORTAL_TAG: unique symbol;
/** React-compatible Fragment sentinel. */
export declare const FRAGMENT_TAG: unique symbol;
/** React-19 `<Activity>` sentinel. */
export declare const ACTIVITY_TAG: unique symbol;
/** Native Octane context object marker. */
export declare const CONTEXT_TAG: unique symbol;
/** `lazy()` wrapper marker. */
export declare const LAZY_COMPONENT_TAG: unique symbol;
/** Suspense boundary component type. */
export declare const SUSPENSE_TAG: unique symbol;
/** Lexical children body marker. */
export declare const CHILDREN_BLOCK_TAG: unique symbol;
/** Owner stamp for a renderer region's host boundary. */
export declare const RENDERER_REGION_OWNER_TAG: unique symbol;
/**
 * React 19 context objects carry this `$$typeof`. Octane only ever READS it to
 * recognize a foreign React context, but it is the same registry contract.
 */
export declare const REACT_CONTEXT_TAG: unique symbol;
