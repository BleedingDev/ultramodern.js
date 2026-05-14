---
name: TanStack Plugin SSR MF Contract
overview: Make TanStack SSR and Module Federation remote rendering executable through @modern-js/plugin-tanstack and generic SSR hooks, with deterministic fallback when remotes cannot render on the server.
todos:
  - id: tpssr-01
    content: Clean the current routes-tanstack-mf dirty patch into a minimal plugin-compatible shell SSR seam, removing broad helper churn and unverified browser expectation changes.
    status: pending
  - id: tpssr-02
    content: Implement plugin-owned TanStack SSR behavior through core hooks: memory history, router load, matched route snapshot, dehydration, hydration scripts, and cleanup.
    status: pending
  - id: tpssr-03
    content: Add the Module Federation SSR bridge contract so server render can resolve remote modules or emit typed deterministic fallback metadata before hydration.
    status: pending
  - id: tpssr-04
    content: Prove loader/action handoff, redirects, notFound, remote unavailable, version-skew, SSR-to-CSR degradation, and telemetry in routes-tanstack-mf.
    status: pending
  - id: tpssr-05
    content: Verify dev, build, serve, and deploy-certification paths for the plugin-enabled TanStack MF fixture without hardcoded localhost topology assumptions leaking into Micro Vertical plans.
    status: pending
isProject: false
---

# TanStack Plugin SSR MF Contract

## Execution Notes

This plan depends on the core hook plan and the plugin package plan. It should not be implemented by continuing to add TanStack-specific behavior inside `@modern-js/runtime`.

The current local `tests/integration/routes-tanstack-mf/**` patch is useful evidence but not ready to land. It showed that shell SSR can be expressed, while remote component SSR remains blocked on a runtime/plugin seam named in the report as `tanstack-mf-server-remote-render`. Clean that work into a minimal executable contract after the plugin architecture is in place.

For Micro Verticals, the target is not merely client fallback. A shell should be able to SSR its route subtree, let TanStack dehydrate deterministically, and either render remote components on the server or produce typed fallback metadata that hydrates predictably.

## Constraints

Keep this scoped to TanStack Router, SSR, Module Federation, hydration, loader/action semantics, fallback, version compatibility, and telemetry.

Do not redesign Module Federation. Use existing Modern.js/MF runtime surfaces plus generic extension hooks.

Do not add AI/MCP/agent runtime operations, migration/codemod, or a second preset.

Do not copy hardcoded localhost remote URLs into Micro Vertical topology acceptance. Fixture URLs are test-only.

## Operator Guidance

Primary hotspots are `packages/runtime/plugin-tanstack/**`, `packages/runtime/plugin-runtime/src/core/server/**`, `packages/runtime/plugin-runtime/src/core/browser/**`, `packages/runtime/plugin-runtime/src/cli/ssr/**`, `tests/integration/routes-tanstack-mf/**`, and `.codex/reports/routes-tanstack-mf-ssr-gap-matrix-20260514.md`.

Verification should start with contract tests, then browser integration with an explicit `PUPPETEER_EXECUTABLE_PATH` when needed, then deploy-certification. If server-side remote rendering is impossible with existing MF runtime surfaces, stop at a passing explicit hook contract and file the exact missing MF runtime seam before expanding scope.
