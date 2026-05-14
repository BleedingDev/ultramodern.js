---
name: TanStack Plugin Core Hooks
overview: Add the generic Modern.js router and SSR extension hooks needed for a TanStack Router plugin without introducing TanStack dependencies into @modern-js/runtime core.
todos:
  - id: tpcore-01
    content: Audit current TanStack-specific code under @modern-js/runtime and classify each surface as generic hook, plugin-owned implementation, compatibility shim, or removable fixture code.
    status: completed
  - id: tpcore-02
    content: Generalize router CLI extension points for plugin-owned route directories, entry detection, generateEntryCode ownership, route-spec merging, and file-change regeneration.
    status: completed
  - id: tpcore-03
    content: Add generic SSR runtime hooks for plugin-owned router creation, server data dehydration, hydration script collection, route match snapshots, and fallback metadata.
    status: pending
  - id: tpcore-04
    content: Prove the new hooks with core-only tests and a small non-TanStack test plugin so @modern-js/runtime has no direct TanStack package requirement.
    status: pending
isProject: false
---

# TanStack Plugin Core Hooks

## Execution Notes

PR #8317 establishes the architecture constraint: Modern.js maintainers are open to TanStack Router support, but not by importing TanStack packages directly into `@modern-js/runtime`. Core should provide extension hooks; TanStack behavior should live in `@modern-js/plugin-tanstack`.

This plan is the upstream-friendly core slice. It should make router generation and SSR runtime extension possible for external router plugins, while keeping React Router as the built-in/default router path.

The old PR branch `bleedingdev/feat/tanstack-router-tailwind-first-class` contains useful precedent for route-directory metadata, filtered built-in router entrypoints, route-spec JSON merge behavior, keyed file-change regeneration, and returning generated routes by entry. Port those ideas deliberately; do not cherry-pick broad unrelated branch churn.

`tpcore-01` is complete. The audits are captured in `.codex/reports/tpcore-01-runtime-core-audit.md`, `.codex/reports/tpcore-01-pr8317-plugin-prototype-audit.md`, and `.codex/reports/tpcore-01-mf-fixture-dirty-patch-audit.md`. The agreed next slice is `tpcore-02`: generic router CLI extension points only. Do not move TanStack runtime or MF fixture code in that slice.

`tpcore-02` is complete. Runtime core now exposes generic CLI seams for plugin-owned route directories, scoped route generation, keyed file-change regeneration, generated routes by entry, built-in route filtering, and route-spec JSON merge behavior. The focused proof is `packages/runtime/plugin-runtime/tests/router/cliExtension.test.ts`.

## Constraints

Do not import `@tanstack/*` from `@modern-js/runtime` core in this plan.

Do not move fixtures, create scaffolds, or docs in this plan except for tests that prove generic hooks.

Do not implement Micro Vertical topology, migration/codemod, AI/MCP, or alternate preset work.

Do not land `routes-tanstack-mf` fixture changes here; that is downstream of plugin extraction.

## Operator Guidance

Primary hotspots are `packages/runtime/plugin-runtime/src/router/cli/index.ts`, `packages/runtime/plugin-runtime/src/router/cli/handler.ts`, `packages/runtime/plugin-runtime/src/router/cli/entry.ts`, `packages/runtime/plugin-runtime/src/router/cli/code/index.ts`, `packages/runtime/plugin-runtime/src/core/server/**`, `packages/runtime/plugin-runtime/src/core/browser/**`, and runtime hook type definitions.

Acceptance is architectural: a plugin can own route generation and SSR lifecycle participation without TanStack being a core dependency. Verification should include package build plus focused runtime/CLI hook tests.
