---
name: Ultramodern MV Core Router Seams
overview: Expose router-agnostic runtime seams required for TanStack-first SSR and Module Federation composition so Micro Vertical behavior does not depend on React Router-specific internals.
todos:
  - id: umcrs-01
    content: Freeze a router-neutral target contract for router creation, SSR load and dehydrate, hydration bootstrap, redirects, notFound, and matched-route asset ownership.
    status: completed
  - id: umcrs-02
    content: Add lifecycle hooks around router creation and SSR hydration so TanStack and React Router paths can be swapped without hidden framework internals.
    status: completed
  - id: umcrs-03
    content: Unify runtime context shape across router implementations instead of keeping divergent routerContext and tanstackRouter internals.
    status: completed
  - id: umcrs-04
    content: Add parity coverage for SSR, hydration, redirect, blocker, loader, mutation, and asset-manifest behavior across TanStack and React Router lanes.
    status: completed
isProject: false
---

# Ultramodern MV Core Router Seams

## Execution Notes

This plan comes directly from the current chat conclusion that `presetUltramodern` can enforce direction, but it cannot invent missing runtime hooks. The present repo already has two separate router implementations, but the seam is still too thin to treat TanStack as a fully first-class replacement path for SSR plus MF composition.

The goal is not to delete React Router support. The goal is to make the framework depend on one stable router contract and let both TanStack and React Router implement that contract.

`umcrs-02` through `umcrs-04` are completed after:

- router lifecycle hooks landed for before/after create and before/after hydrate phases,
- runtime context exposed one router-neutral state shape plus public `routerFramework`,
- targeted router seam tests landed under `packages/runtime/plugin-runtime/tests/router/lifecycle.test.tsx`,
- and TanStack route parity coverage passed again through `tests/integration/routes-tanstack/tests/tanstack-data-flow-contract.test.ts` plus `tests/integration/routes-tanstack/tests/index.test.ts`.

## Constraints

1. Preserve existing compatibility lanes for React Router and TanStack.
2. Avoid adding a second public preset or a router-specific product mode.
3. Keep mergeability high by preferring additive seams over repo-wide rewrites.
4. Do not encode business-domain workflow assumptions in router contracts.

## Operator Guidance

Treat this as the main technical blocker for true single-preset Micro Verticals. If this seam stays weak, the preset will keep papering over runtime differences and the architecture will remain brittle.

Favor framework-level abstractions for:
- router creation
- SSR preparation and dehydrate
- hydration bootstrap payload injection
- matched route metadata and asset ownership
- navigation and blocking lifecycle

## References

- [packages/runtime/plugin-runtime/src/router/runtime/plugin.tsx](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/router/runtime/plugin.tsx)
- [packages/runtime/plugin-runtime/src/router/runtime/plugin.node.tsx](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/router/runtime/plugin.node.tsx)
- [packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx)
- [packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx)
- [packages/runtime/plugin-runtime/src/router/runtime/hooks.ts](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/router/runtime/hooks.ts)
- [packages/runtime/plugin-runtime/src/core/context/runtime.ts](/Users/satan/side/experiments/modernjs/packages/runtime/plugin-runtime/src/core/context/runtime.ts)
