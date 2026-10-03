/** Inert compiler/bundler manifest for one independently activatable boundary. */
export declare const INDEPENDENT_HYDRATE_MANIFEST_ATTR = "data-octane-independent";
export declare const HYDRATE_INDEPENDENT_ATTR = "data-octane-hydrate-independent";
/** Compiler-owned stable key for a native control that can receive input before activation. */
export declare const HYDRATE_INPUT_ATTR = "data-octane-input";
/** Server-only writable-signal identity joined to a compiler control site. */
export declare const SIGNAL_CONTROL_ATTR = "data-octane-signal-control";
/** Stable id of a server-rendered deferred hydration boundary. */
export declare const HYDRATE_ID_ATTR = "data-octane-hydrate-id";
/** Serialized strategy kind (`visible`, `idle`, `dynamic`, …). */
export declare const HYDRATE_WHEN_ATTR = "data-octane-hydrate-when";
/**
 * Serialized built-in strategy parameters. An independent island reads these
 * because its lexical parent (which evaluated `when`) never runs on the client.
 */
export declare const HYDRATE_IDLE_TIMEOUT_ATTR = "data-octane-hydrate-timeout";
export declare const HYDRATE_VISIBLE_MARGIN_ATTR = "data-octane-hydrate-root-margin";
export declare const HYDRATE_VISIBLE_THRESHOLD_ATTR = "data-octane-hydrate-threshold";
export declare const HYDRATE_MEDIA_ATTR = "data-octane-hydrate-media";
/** Number of `useId()` slots consumed while rendering the deferred child. */
export declare const HYDRATE_ID_COUNT_ATTR = "data-octane-hydrate-id-count";
/** Direct-child JSON script carrying this boundary's `use()` seed slice. */
export declare const HYDRATE_SEED_ATTR = "data-octane-hydrate-seed";
/** Matches any server-rendered deferred hydration boundary wrapper. */
export declare const HYDRATE_MARKER_SELECTOR = "[data-octane-hydrate-id]";
/** Single-character payload of a block-open comment. */
export declare const HYDRATION_START = "[";
/** Single-character payload of a block-close comment. */
export declare const HYDRATION_END = "]";
/** Leading payload shared by both `@for` outer-open markers. */
export declare const HYDRATION_FOR_PREFIX = "[f";
/** @for outer-open payload: the server rendered its @empty arm. */
export declare const HYDRATION_FOR_EMPTY = "[f0";
/** @for outer-open payload: the server rendered one or more direct-host items. */
export declare const HYDRATION_FOR_ITEMS = "[f1";
/** Index of the arm digit ('0' or '1') inside either @for outer-open payload. */
export declare const HYDRATION_FOR_ARM_INDEX: number;
/**
 * Serialize one `useId()` value. The client regenerates the id the server
 * already wrote, so the namespace prefix, the `in-` infix, the base-36 ordinal,
 * and both colons must be produced in exactly one place: a divergence here
 * survives every test that only checks one side and then mismatches every
 * `useId` consumer at hydration.
 */
export declare function formatUseId(prefix: string, ordinal: number): string;
