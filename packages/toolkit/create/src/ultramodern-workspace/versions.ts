/**
 * Every version pin and skill-repo commit hash baked into generated
 * UltraModern workspaces lives here. Values must stay in lockstep with the
 * checked-in templates under templates/ and template-workspace/.
 */
export const TANSTACK_ROUTER_VERSION = '1.170.17';
export const TANSTACK_ROUTER_CORE_VERSION = '1.171.14';
export const MODULE_FEDERATION_VERSION = '2.8.0';
export const ZEPHYR_RSPACK_PLUGIN_VERSION = '1.1.1';
export const ZEPHYR_AGENT_VERSION = '1.1.1';
export const WRANGLER_VERSION = '4.110.0';
export const CLOUDFLARE_COMPATIBILITY_DATE = '2026-06-02';
export const TAILWIND_VERSION = '4.3.2';
export const RSBUILD_PLUGIN_TAILWINDCSS_VERSION = '2.0.3';
export const EFFECT_VERSION = '4.0.0-beta.97';
export const EFFECT_VITEST_VERSION = '4.0.0-beta.97';
export const EFFECT_TSGO_VERSION = '0.19.0';
export const DRIZZLE_ORM_VERSION = '1.0.0-rc.4';
export const TYPESCRIPT_STABLE_VERSION = '7.0.2';
export const TYPESCRIPT_VERSION = TYPESCRIPT_STABLE_VERSION;
export const TYPESCRIPT_NATIVE_PREVIEW_VERSION = '7.0.0-dev.20260707.2';
export const OXLINT_VERSION = '1.73.0';
export const OXFMT_VERSION = '0.58.0';
export const ULTRACITE_VERSION = '7.9.3';
export const LEFTHOOK_VERSION = '^2.1.10';
export const I18NEXT_VERSION = '26.3.6';
export const MODULE_FEDERATION_NODE_VERSION = '2.7.47';
export const MINIFLARE_VERSION = '4.20260708.1';
export const WORKERD_VERSION = '1.20260708.1';
export const CLOUDFLARE_WORKERS_TYPES_VERSION = '5.20260710.1';
export const NODE_FETCH_VERSION = '^3.3.2';
// Platform Baseline producer pins are exact (CONTEXT.md: "pinned platform-wide";
// baseline reclassification MV-G16-R). Composition-time singletons like React
// never float; the cohort advances centrally as an exact bump.
export const REACT_VERSION = '19.2.7';
export const REACT_DOM_VERSION = '19.2.7';
export const REACT_ROUTER_VERSION = '7.18.1';
export const TYPES_REACT_VERSION = '^19.2.17';
export const TYPES_REACT_DOM_VERSION = '^19.2.3';
export const NODE_VERSION = '26.5.0';
export const PNPM_VERSION = '11.16.0';
const RSTACK_AGENT_SKILLS_COMMIT = '61c948b42512e223bad44b83af4080eba48b2677';
const MODULE_FEDERATION_AGENT_SKILLS_COMMIT =
  '07bb5b6c43ad457609e00c081b72d4c42508ec76';

export const ultramodernWorkspaceVersions = {
  tanstackRouter: TANSTACK_ROUTER_VERSION,
  tanstackRouterCore: TANSTACK_ROUTER_CORE_VERSION,
  moduleFederation: MODULE_FEDERATION_VERSION,
  effect: EFFECT_VERSION,
  effectVitest: EFFECT_VITEST_VERSION,
  drizzleOrm: DRIZZLE_ORM_VERSION,
  typescript: TYPESCRIPT_VERSION,
  typescriptNativePreview: TYPESCRIPT_NATIVE_PREVIEW_VERSION,
  moduleFederationNode: MODULE_FEDERATION_NODE_VERSION,
  miniflare: MINIFLARE_VERSION,
  workerd: WORKERD_VERSION,
  cloudflareWorkersTypes: CLOUDFLARE_WORKERS_TYPES_VERSION,
  tailwind: TAILWIND_VERSION,
  rsbuildPluginTailwindcss: RSBUILD_PLUGIN_TAILWINDCSS_VERSION,
};
