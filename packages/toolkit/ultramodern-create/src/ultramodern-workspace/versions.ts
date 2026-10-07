/**
 * Every version pin and skill-repo commit hash baked into generated
 * UltraModern workspaces lives here. Values must stay in lockstep with the
 * checked-in templates under templates/ and template-workspace/.
 */
export const TANSTACK_ROUTER_VERSION = '1.170.41';
export const TANSTACK_ROUTER_CORE_VERSION = '1.171.34';
export const TANSTACK_HISTORY_VERSION = '1.162.4';
export const MODULE_FEDERATION_VERSION = '2.9.2';
// Fork release identities advance independently of the upstream MF protocol.
export const MODULE_FEDERATION_BRIDGE_REACT_FORK_VERSION = '2.9.3';
export const MODULE_FEDERATION_RUNTIME_FORK_VERSION = '2.9.3';
// The mf-modern-js-v3 sidecar is upstream 2.9.2 plus the repository patch. Its
// fork version moves past 2.9.2 because published sidecar versions are
// immutable: 2.9.2 carries upstream 2.9.1 bytes and 2.9.3 predates the
// renderer hunks (router-free `/base` bridge entry). 2.9.4 also pins the
// dts-plugin 2.9.3 cascade. Its DTS worker witness and onDevWorkerCreated
// hunks no longer have a consumer; they drop at the next dts-plugin version.
export const MODULE_FEDERATION_MODERN_JS_V3_FORK_VERSION = '2.9.4';
export const ZEPHYR_RSPACK_PLUGIN_VERSION = '1.4.2';
export const ZEPHYR_AGENT_VERSION = '1.4.2';
export const WRANGLER_VERSION = '4.145.0';
export const CLOUDFLARE_COMPATIBILITY_DATE = '2026-06-02';
export const TAILWIND_VERSION = '4.3.3';
export const RSBUILD_PLUGIN_TAILWINDCSS_VERSION = '2.0.3';
// FORK: upstream Modern.js has no Effect lane at all. `EFFECT_VERSION` is the
// single source of truth for the fork's lockstep Effect cohort — moving it
// requires moving the exact `effect` and `@effect/opentelemetry` peer and
// development pins of the canonical BFF packages in the same commit. Upstream
// Effect 4 builds router params by assignment without string code generation.
// The cohort consumes upstream Effect without a patch or sidecar.
// See FORK-DIVERGENCE.md, packages/toolkit/ultramodern-create.
export const EFFECT_VERSION = '4.0.0';
export const EFFECT_TSGO_VERSION = '0.47.2';
export const TYPESCRIPT_STABLE_VERSION = '7.0.2';
export const TYPESCRIPT_VERSION = TYPESCRIPT_STABLE_VERSION;
export const OXLINT_VERSION = '1.85.0';
export const OXFMT_VERSION = '0.70.0';
export const ULTRACITE_VERSION = '7.12.0';
export const CROSS_ENV_VERSION = '10.1.0';
export const LEFTHOOK_VERSION = '^2.1.14';
export const I18NEXT_VERSION = '26.4.2';
export const MODULE_FEDERATION_NODE_VERSION = '2.7.52';
export const MINIFLARE_VERSION = '5.20260930.0-alpha';
export const WORKERD_VERSION = '1.20260930.2';
export const CLOUDFLARE_WORKERS_TYPES_VERSION = '5.20261001.1';
export const NODE_FETCH_VERSION = '^3.3.2';
// Platform Baseline producer pins are exact (CONTEXT.md: "pinned platform-wide";
// baseline reclassification MV-G16-R). Composition-time singletons like React
// never float; the cohort advances centrally as an exact bump.
export const REACT_VERSION = '19.3.0';
export const REACT_DOM_VERSION = '19.3.0';
export const TYPES_NODE_VERSION = '^26.6.3';
export const TYPES_REACT_VERSION = '^19.3.0';
export const TYPES_REACT_DOM_VERSION = '^19.3.0';
export const NODE_VERSION = '26.10.0';
export const PNPM_VERSION = '12.8.1';

export const ULTRAMODERN_PACKAGE_PINS = {
  appDependencies: {
    // Generated apps never install react-router — TanStack Router is the
    // frontend router — yet `@module-federation/bridge-react` must stay a
    // direct dependency: the MF plugin only honours `enableBridgeRouter: false`
    // by aliasing bridge-react to its router-free `base` entry when it finds
    // the package in the app's own `package.json`. Drop it and the default,
    // `react-router-dom`-importing entry is bundled again.
    '@module-federation/bridge-react': `npm:@bleedingdev/mf-bridge-react@${MODULE_FEDERATION_BRIDGE_REACT_FORK_VERSION}`,
    '@module-federation/modern-js-v3': `npm:@bleedingdev/mf-modern-js-v3@${MODULE_FEDERATION_MODERN_JS_V3_FORK_VERSION}`,
    '@module-federation/runtime': `npm:@bleedingdev/mf-runtime@${MODULE_FEDERATION_RUNTIME_FORK_VERSION}`,
    '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
    i18next: I18NEXT_VERSION,
    'node-fetch': NODE_FETCH_VERSION,
    react: REACT_VERSION,
    'react-dom': REACT_DOM_VERSION,
  },
  // Optional Effect peers are supplied by each Effect app using one exact package identity.
  bffEffectDependencies: {
    '@effect/opentelemetry': EFFECT_VERSION,
    effect: EFFECT_VERSION,
  },
  appDevDependencies: {
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    '@rsbuild/plugin-tailwindcss': `^${RSBUILD_PLUGIN_TAILWINDCSS_VERSION}`,
    '@typescript/native': `npm:typescript@${TYPESCRIPT_VERSION}`,
    '@types/node': TYPES_NODE_VERSION,
    '@types/react': TYPES_REACT_VERSION,
    '@types/react-dom': TYPES_REACT_DOM_VERSION,
    tailwindcss: `^${TAILWIND_VERSION}`,
    typescript: TYPESCRIPT_VERSION,
    wrangler: WRANGLER_VERSION,
    'zephyr-rspack-plugin': ZEPHYR_RSPACK_PLUGIN_VERSION,
  },
  rootDevDependencies: {
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    '@typescript/native': `npm:typescript@${TYPESCRIPT_VERSION}`,
    '@types/node': TYPES_NODE_VERSION,
    lefthook: LEFTHOOK_VERSION,
    miniflare: MINIFLARE_VERSION,
    oxlint: OXLINT_VERSION,
    oxfmt: OXFMT_VERSION,
    ultracite: ULTRACITE_VERSION,
    wrangler: WRANGLER_VERSION,
    'zephyr-agent': ZEPHYR_AGENT_VERSION,
  },
  transitiveDependencies: {
    '@cloudflare/workers-types': CLOUDFLARE_WORKERS_TYPES_VERSION,
    '@module-federation/node': MODULE_FEDERATION_NODE_VERSION,
    '@tanstack/history': TANSTACK_HISTORY_VERSION,
    '@tanstack/router-core': TANSTACK_ROUTER_CORE_VERSION,
    '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    miniflare: MINIFLARE_VERSION,
    workerd: WORKERD_VERSION,
  },
} as const;
