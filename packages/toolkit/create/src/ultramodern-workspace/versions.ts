/**
 * Every version pin and skill-repo commit hash baked into generated
 * UltraModern workspaces lives here. Values must stay in lockstep with the
 * checked-in templates under templates/ and template-workspace/.
 */
export const TANSTACK_ROUTER_VERSION = '1.170.25';
export const TANSTACK_ROUTER_CORE_VERSION = '1.171.21';
export const TANSTACK_HISTORY_VERSION = '1.162.1';
export const MODULE_FEDERATION_VERSION = '2.8.2';
export const ZEPHYR_RSPACK_PLUGIN_VERSION = '1.2.1';
export const ZEPHYR_AGENT_VERSION = '1.2.1';
// Wrangler 4.120.0 pulls Miniflare 5 alpha. Keep the newest coherent v4 lane.
export const WRANGLER_VERSION = '4.116.0';
export const CLOUDFLARE_COMPATIBILITY_DATE = '2026-06-02';
export const TAILWIND_VERSION = '4.3.3';
export const RSBUILD_PLUGIN_TAILWINDCSS_VERSION = '2.0.3';
// FORK: upstream Modern.js has no Effect lane at all. `EFFECT_VERSION` is the
// single source of truth for the fork's lockstep Effect cohort — moving it
// requires moving, in the same commit: pnpm-workspace.yaml
// `minimumReleaseAgeExclude`, packages/cli/plugin-bff/package.json
// (`peerDependencies` and `devDependencies` for BOTH `effect` and
// `@effect/opentelemetry` — they are exact optional peers, not dependencies,
// so all four pins move together), and template-workspace/patches/
// effect-schema-error-type-id.patch (regenerate via `pnpm patch effect@<v>`;
// its blob index lines are version-specific and a stale patch fails to apply).
// See FORK-DIVERGENCE.md, packages/toolkit/create.
export const EFFECT_VERSION = '4.0.0-beta.107';
export const EFFECT_VITEST_VERSION = '4.0.0-beta.107';
export const EFFECT_TSGO_VERSION = '0.36.2';
export const DRIZZLE_ORM_VERSION = '1.0.0-rc.4';
export const TYPESCRIPT_STABLE_VERSION = '7.0.2';
export const TYPESCRIPT_VERSION = TYPESCRIPT_STABLE_VERSION;
export const TYPESCRIPT_NATIVE_PREVIEW_VERSION = '7.0.0-dev.20260707.2';
export const OXLINT_VERSION = '1.78.0';
export const OXFMT_VERSION = '0.63.0';
export const ULTRACITE_VERSION = '7.10.2';
export const LEFTHOOK_VERSION = '^2.1.10';
export const I18NEXT_VERSION = '26.3.6';
export const MODULE_FEDERATION_NODE_VERSION = '2.7.49';
export const MINIFLARE_VERSION = '4.20260730.0';
export const WORKERD_VERSION = '1.20260730.1';
export const CLOUDFLARE_WORKERS_TYPES_VERSION = '5.20260810.1';
export const NODE_FETCH_VERSION = '^3.3.2';
// Platform Baseline producer pins are exact (CONTEXT.md: "pinned platform-wide";
// baseline reclassification MV-G16-R). Composition-time singletons like React
// never float; the cohort advances centrally as an exact bump.
export const REACT_VERSION = '19.2.8';
export const REACT_DOM_VERSION = '19.2.8';
export const TYPES_NODE_VERSION = '^26.2.0';
export const TYPES_REACT_VERSION = '^19.2.18';
export const TYPES_REACT_DOM_VERSION = '^19.2.4';
export const NODE_VERSION = '26.7.0';
export const PNPM_VERSION = '11.21.0';
const RSTACK_AGENT_SKILLS_COMMIT = '61c948b42512e223bad44b83af4080eba48b2677';
const MODULE_FEDERATION_AGENT_SKILLS_COMMIT =
  '07bb5b6c43ad457609e00c081b72d4c42508ec76';
