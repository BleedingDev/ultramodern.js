# Upstream PR Queue - 2026-06-13

This queue turns the fork divergence ledger into small upstreamable PRs. It is intentionally limited to changes that can stand alone in `web-infra-dev/modern.js` or the relevant external project without importing UltraModern-only product policy.

## Ready First

| Priority | Target | Candidate | Why it is separable |
| --- | --- | --- | --- |
| P0 | `web-infra-dev/modern.js` | `packages/server/core/src/plugins/render/render.ts` `matchRoute` miss typing | Upstream currently returns an empty array cast to `MatchedRoute` on a miss; the fork returns `[undefined, {}]` and types the first tuple item as optional. This is a plain correctness fix. |
| P1 | `web-infra-dev/modern.js` | `packages/cli/builder/src/plugins/environmentDefaults.ts` service-worker ESM library output | The fork honors `output.module` instead of hardcoding `commonjs2`; no UltraModern policy required. |
| P1 | `web-infra-dev/modern.js` | `packages/cli/builder/src/plugins/postcss.ts` app-root plugin resolution | Resolves PostCSS/Tailwind plugins from the app root with `createRequire`, fixing monorepo/workspace installs. |
| P1 | `web-infra-dev/modern.js` | `packages/cli/plugin-styled-components` styled-components v6 type fix | Replaces a removed `StyledInterface` type dependency with a shape derived from `styledComponents.default`. |
| P1 | `web-infra-dev/modern.js` | `packages/server/core/src/adapters/node/plugins/static.ts` pre-compressed static assets | Serves `.br`/`.gz` with Accept-Encoding q-value handling; useful outside the fork. |

## Next Batch

| Priority | Target | Candidate | Notes |
| --- | --- | --- | --- |
| P2 | `web-infra-dev/modern.js` | `packages/server/server` typed `CreateDevServerResult` and watcher/file-reader undefined guards | Keep the dev-mock non-ASCII route matching change out unless deliberately accepted. |
| P2 | `web-infra-dev/modern.js` | `packages/toolkit/i18n-utils/src/index.ts` edge-safe `languageDetector` process guard | Small worker/edge compatibility fix. |
| P2 | `web-infra-dev/modern.js` | `packages/toolkit/plugin` duplicate plugin detection across internal and config plugins | Needs a focused test showing duplicate detection without fork plugin assumptions. |
| P2 | `web-infra-dev/modern.js` | `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx` prefetch behavior | Split into intent/render/viewport and chunk-preload commits if review size grows. |
| P2 | Module Federation upstream | Lazy DTS loading for `@module-federation/manifest` and `@module-federation/rspack` | External dependency fix currently carried in `patches/`; see `patches/README.md`. |

## Do Not Queue As Upstream PRs

- UltraModern workspace generator defaults, `@bleedingdev` package-source policy, generated Tractor proof scripts, and root publish policy.
- Effect-first BFF runtime wiring, telemetry/autopilot contract gates, `@modern-js/server-runtime-extensions`, and Module Federation SSR topology evidence.
- TanStack Router as a first-class fork plugin package.
- Garfish trust/runtime parity work. `packages/runtime/plugin-garfish` was deleted in Phase A-C; Module Federation is the live composition lane.
- App-level shims, demo-only navigation wrappers, or local suppressions that hide framework/runtime defects.

## Queue Hygiene

1. Each PR should have one behavior owner and one regression test.
2. Keep package source and dependency major-version migrations together when a candidate touches both.
3. Land upstream bug fixes before the next upstream sync where possible, then remove the matching `[U]` ledger entry.
4. For the Module Federation patches, remove local patches only after the external upstream release is consumed and the lockfile no longer records the patch hash.
