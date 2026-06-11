/**
 * Canonical (language-agnostic) route map.
 *
 * Empty by default; populated via declaration merging by the generated
 * `register.gen.d.ts` that `@modern-js/plugin-tanstack` emits:
 *
 * ```ts
 * declare module '@modern-js/plugin-i18n/runtime' {
 *   interface UltramodernCanonicalRoutes {
 *     '/': Record<string, never>;
 *     '/talks': Record<string, never>;
 *     '/talks/$slug': { slug: string };
 *   }
 * }
 * ```
 *
 * Keys are canonical route patterns in TanStack notation (`$param`,
 * `{-$param}`); values describe the route's path params.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by generated code
export interface UltramodernCanonicalRoutes {}

export type CanonicalRoutePath = keyof UltramodernCanonicalRoutes & string;

type HasCanonicalRoutes = [keyof UltramodernCanonicalRoutes] extends [never]
  ? false
  : true;

/**
 * Targets that bypass canonical-route validation: external URLs, same-page
 * hash anchors, and canonical paths with a `?search` and/or `#hash` suffix
 * (the pathname part of suffixed targets is still validated).
 */
type ExternalLinkTarget =
  | `http://${string}`
  | `https://${string}`
  | `mailto:${string}`
  | `tel:${string}`
  | `//${string}`;

type SuffixedCanonicalTarget =
  | `${CanonicalRoutePath}?${string}`
  | `${CanonicalRoutePath}#${string}`;

export type AllowedLinkTarget =
  | CanonicalRoutePath
  | SuffixedCanonicalTarget
  | ExternalLinkTarget
  | `#${string}`;

/**
 * Validates a literal `to` against the canonical route map. Computed strings
 * (type `string`) always pass — the escape hatch for dynamic values. When no
 * canonical map has been generated, everything passes.
 */
export type ValidateLinkTo<TTo extends string> =
  HasCanonicalRoutes extends false
    ? unknown
    : string extends TTo
      ? unknown
      : TTo extends AllowedLinkTarget
        ? unknown
        : {
            to: {
              error: 'Not a canonical route. Authors must write language-agnostic paths; see UltramodernCanonicalRoutes.';
              received: TTo;
            };
          };

/** Strip `?search`/`#hash` suffixes from a link target type. */
export type LinkTargetPathname<TTo extends string> =
  TTo extends `${infer TPath}#${string}`
    ? TPath extends `${infer TPure}?${string}`
      ? TPure
      : TPath
    : TTo extends `${infer TPath}?${string}`
      ? TPath
      : TTo;

/**
 * `params` prop contract for a canonical target: required when the route has
 * required params, optional when all params are optional, forbidden when the
 * route has none. Non-canonical (computed/external) targets accept a loose
 * record.
 */
export type LinkParamsProp<TPath extends string> =
  TPath extends CanonicalRoutePath
    ? UltramodernCanonicalRoutes[TPath] extends Record<string, never>
      ? { params?: undefined }
      : Record<string, never> extends UltramodernCanonicalRoutes[TPath]
        ? { params?: UltramodernCanonicalRoutes[TPath] }
        : { params: UltramodernCanonicalRoutes[TPath] }
    : { params?: Record<string, string | number | undefined> };
