---
name: ultramodern-tanstack-fast-defaults-04-rsbuild-start-alignment
overview: Align UltraModern's TanStack Router integration with the newly first-class TanStack Start Rsbuild adapter by borrowing the proven Rsbuild/Rspack patterns that matter for speed by default: explicit client/server environment planning, Rspack route code splitting, normalized client build manifests, import-boundary protection, RSC layering, and build-order guarantees, without replacing Modern.js runtime ownership or introducing app-level shims.
todos:
  - id: map-start-rsbuild-adapter
    content: Produce a source map of `@tanstack/react-start/plugin/rsbuild` and `@tanstack/start-plugin-core/rsbuild`, covering environment planning, route generator/code-splitter registration, manifest capture, server-function virtual modules, import protection, RSC layering, dev middleware, and build-order hooks.
    status: pending
  - id: audit-modern-rsbuild-surfaces
    content: Audit UltraModern's current Modern Rsbuild/Rspack surfaces across `@modern-js/plugin-tanstack`, `@modern-js/plugin-runtime` SSR, generated UltraModern config, Module Federation SSR, Zephyr, Cloudflare Worker SSR, and existing route chunk settings.
    status: pending
  - id: design-tanstack-rsbuild-profile
    content: Design a framework-owned UltraModern TanStack Rsbuild profile that specifies client/server environment contracts, asset/basepath handling, SSR bootstrap assets, manifest ownership, and performance defaults while keeping Modern.js runtime and deployment semantics intact.
    status: pending
  - id: plan-rspack-route-splitting
    content: Plan Rspack-backed TanStack route generation/code-splitting integration, including whether UltraModern should use `@tanstack/router-plugin/rspack`, how it interacts with `output.splitRouteChunks`, and how generated route artifacts preserve SSR/RSC behavior.
    status: pending
  - id: plan-client-build-manifest
    content: Plan a normalized client build manifest path for TanStack routes that can identify entry assets, async route chunks, static imports, dynamic imports, CSS, HMR exclusions, and SSR preload/bootstrap needs under Rsbuild/Rspack.
    status: pending
  - id: plan-import-boundaries
    content: Decide whether UltraModern needs Start-style import protection and server/client boundary checks for TanStack loaders, actions, BFF/server functions, and RSC modules, then define the minimal framework-owned enforcement surface.
    status: pending
  - id: validate-rsc-and-mf-coexistence
    content: Validate the proposed Rsbuild profile against Modern RSC, Module Federation SSR, Zephyr Rspack, Cloudflare Worker SSR, and generated asset-prefix contracts so fast defaults do not break deployment targets.
    status: pending
  - id: define-rsbuild-performance-proof
    content: Define the proof matrix for the Rsbuild integration: inspected Rsbuild/Rspack config, chunk graph assertions, navigation/render-budget smoke tests, SSR asset bootstrap checks, and Rsdoctor-compatible diagnostics.
    status: pending
isProject: false
---

# TanStack Fast Defaults: Rsbuild Start Alignment

## Execution Notes

TanStack announced first-class Rsbuild 2 support for Start on 2026-06-02. The public contract is a normal Rsbuild plugin, `tanstackStart()`, from `@tanstack/react-start/plugin/rsbuild`; the blog states that Rsbuild owns the build while the framework plugin wires Start into both client and server builds. The important lesson for UltraModern is not "adopt Start"; it is the adapter boundary: shared TanStack build behavior lives in core, while build-tool-specific behavior lives in the Rsbuild adapter.

The published packages show the Rsbuild adapter doing several things UltraModern should evaluate:

- `@tanstack/react-start/src/plugin/rsbuild.ts` is a thin framework entry that delegates to `@tanstack/start-plugin-core/rsbuild`, sets React defaults, chooses the server provider environment, and changes behavior when RSC is enabled.
- `@tanstack/start-plugin-core/src/rsbuild/planning.ts` creates explicit `client` and `ssr` environments, keeps client assets under an assets directory, uses async-only chunk splitting so initial SSR bootstrap can stay predictable, and handles server output differently in dev/build.
- `@tanstack/start-plugin-core/src/rsbuild/plugin.ts` applies defines, dev SSR/server-function middleware, import protection, virtual modules, RSC layer plugins, client-build capture, manifest replacement, Rspack multi-compiler dependencies, and post-build/prerender hooks.
- `@tanstack/start-plugin-core/src/rsbuild/start-router-plugin.ts` registers `TanStackRouterGeneratorRspack` only on the client environment and `TanStackRouterCodeSplitterRspack` on both client and server, with client-only deletion of server-only route nodes.
- `@tanstack/start-plugin-core/src/rsbuild/normalized-client-build.ts` normalizes Rspack chunks into route-aware manifest data by tracking entry chunks, async route chunks, dynamic imports, static sibling imports, CSS assets, and HMR exclusions.

Local UltraModern evidence:

- `packages/runtime/plugin-tanstack/src/cli/index.ts:221` owns the Modern TanStack CLI plugin, runtime plugin injection, route entry detection, entry code generation, and file-change regeneration.
- `packages/runtime/plugin-tanstack/src/runtime/plugin.tsx:324` and `packages/runtime/plugin-tanstack/src/runtime/plugin.node.tsx:441` create client and SSR TanStack routers directly inside Modern runtime hooks.
- `packages/runtime/plugin-runtime/src/cli/ssr/index.ts:253` owns the Modern SSR Rsbuild plugin and modifies environment config for server targets, Cloudflare Worker SSR, RSC, Loadable, and Module Federation SSR markers.
- `packages/toolkit/create/src/ultramodern-workspace.ts:1113` generates UltraModern config with `tanstackRouterPlugin()`, Module Federation, Zephyr Rspack, Cloudflare deploy options, `assetPrefix`, `polyfill: 'off'`, and `splitRouteChunks: false`; `:4271` records the generated contract.

## Constraints

- Do not import TanStack Start as a runtime replacement for Modern.js. UltraModern should borrow adapter patterns and upstream router-plugin capabilities only where they fit the Modern plugin/runtime ownership model.
- Do not add app-level shims, synthetic navigation wrappers, generated-file hacks, or local suppressions. Any route splitting, manifest, import-boundary, or SSR fix belongs in Modern runtime/tooling/plugin layers.
- Preserve existing Cloudflare Worker SSR, Module Federation SSR, Zephyr Rspack, i18n, asset-prefix, basepath rewrite, and RSC behavior unless a later implementation plan explicitly changes those contracts.
- Treat `output.splitRouteChunks: false` in generated UltraModern config as a current compatibility signal, not as a permanent performance decision. Any change must be justified with SSR asset and route-chunk tests.
- Keep this plan as investigation/design until the operator explicitly starts implementation or subagent execution.

## References

- https://tanstack.com/blog/start-adds-rsbuild-support
- https://tanstack.com/start/latest/docs/framework/react/build-tools
- https://github.com/TanStack/router
- https://www.npmjs.com/package/@tanstack/react-start
- https://www.npmjs.com/package/@tanstack/start-plugin-core
- `.codex/plans/ultramodern-tanstack-fast-defaults-01-router-runtime.plan.md`
- `.codex/plans/ultramodern-tanstack-fast-defaults-02-search-contracts.plan.md`
- `.codex/plans/ultramodern-tanstack-fast-defaults-03-scaffold-render-budget.plan.md`

## Operator Guidance

Run this lane in parallel with the existing read-only scouts first. The adapter map and Modern surface audit are read-only and should finish before any worker edits `packages/runtime/plugin-runtime/src/cli/ssr/index.ts`, `packages/runtime/plugin-runtime/src/router/cli/code/templates.ts`, `packages/runtime/plugin-tanstack/src/cli/index.ts`, or `packages/toolkit/create/src/ultramodern-workspace.ts`.

Serialize actual implementation ownership later:

- `@modern-js/plugin-runtime` SSR/Rsbuild environment changes should have one owner.
- `@modern-js/plugin-tanstack` route generator/code-splitter changes should have one owner.
- Generated UltraModern config and create-contract changes should have one owner.
- Manifest/chunk graph tests should be owned by a verifier after the design worker names the manifest contract.

Before implementation, decide whether UltraModern should directly use `@tanstack/router-plugin/rspack`, adapt only the concepts, or keep the current Modern route generation and add equivalent Rspack hooks. That decision should be written down before touching runtime files.
