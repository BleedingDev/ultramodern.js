---
name: Ultramodern MF SSR Contract Closure
overview: Close the current ambiguity around federated remote SSR by either implementing true server remote rendering or formally blessing typed SSR fallback plus client hydration as the enforced UltraModern contract.
todos:
  - id: umssr-01
    content: Re-audit routes-tanstack-mf and runtime MF SSR surfaces after the latest TanStack update to decide whether server remote rendering is implementable now with existing hooks.
    status: completed
  - id: umssr-02
    content: If implementable, add the missing plugin or runtime seam and prove server-rendered remote components in routes-tanstack-mf.
    status: completed
  - id: umssr-03
    content: If not implementable now, promote typed SSR fallback plus client hydration from gap marker to official contract with telemetry, docs, and negative tests.
    status: completed
  - id: umssr-04
    content: Update validation gates so MF SSR behavior is explicit, enforced, and no longer documented as an ambiguous gap.
    status: completed
isProject: false
---

# Ultramodern MF SSR Contract Closure

## Execution Notes

Current `routes-tanstack-mf` behavior explicitly emits fallback metadata for federated content during SSR and hydrates remotes on the client. That is acceptable only if it is the product contract. If true server remote rendering is possible after the latest TanStack and runtime polish work, implement it. If not, stop pretending it is a gap and make the fallback contract official.

Primary hotspots are `tests/integration/routes-tanstack-mf/**`, `packages/runtime/plugin-tanstack/src/runtime/**`, `packages/runtime/plugin-runtime/src/core/server/**`, Module Federation config in host and remotes, and the existing SSR gap report under `.codex/reports`.

## Constraints

Do not redesign Module Federation. This lane must either add the minimal missing seam or formalize the existing fallback behavior.

Do not allow ambiguous language in docs or tests after this lane. The chosen SSR behavior must be enforceable.

## Operator Guidance

Run this after TanStack latest dependencies and runtime polish. A newer TanStack version may change SSR behavior, so this decision should be based on the refreshed stack, not the stale baseline.

## Completion Evidence

The refreshed stack still does not expose a proven server remote rendering seam for this fixture. The official contract is now typed SSR fallback metadata in the shell plus client hydration ownership for remote replacement.

Validation now covers fallback metadata schema, fallback telemetry classifications, version-skew classification, MF shared TanStack version alignment, and docs no longer claim guaranteed remote component HTML for every MF SSR route.
