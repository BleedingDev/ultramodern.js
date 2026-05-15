---
name: Ultramodern TanStack Runtime Polish
overview: Remove transitional TanStack runtime baggage and make @modern-js/plugin-tanstack the only polished TanStack path for UltraModern SuperApp development.
todos:
  - id: utsrp-01
    content: Remove explicit deprecated TanStack fields from internal runtime context and update tests to assert only generic router runtime fields are used.
    status: pending
  - id: utsrp-02
    content: Audit and remove or quarantine the old in-runtime TanStack implementation path so generated apps use @modern-js/plugin-tanstack rather than @modern-js/runtime/tanstack-router.
    status: pending
  - id: utsrp-03
    content: Align TanStack SSR hydration, matched-route snapshots, action handoff, and lifecycle hooks around routerRuntime, routerInstance, routerHydrationScript, routerMatchedRouteIds, and routerServerSnapshot.
    status: pending
  - id: utsrp-04
    content: Add focused tests proving no deprecated TanStack-specific runtime context fields, exports, or generated code survive in the UltraModern path.
    status: pending
isProject: false
---

# Ultramodern TanStack Runtime Polish

## Execution Notes

The current runtime already has the desired generic state model: `routerRuntime`, `routerInstance`, `routerHydrationScript`, `routerMatchedRouteIds`, and `routerServerSnapshot`. The problem is leftover TanStack-specific compatibility type surface in `TInternalRuntimeContext` and a legacy in-runtime TanStack path that should not define our polished product direction.

Primary hotspots are `packages/runtime/plugin-runtime/src/core/context/runtime.ts`, `packages/runtime/plugin-runtime/src/router/runtime/**`, `packages/runtime/plugin-tanstack/src/runtime/**`, `packages/runtime/plugin-tanstack/src/cli/**`, and tests under `packages/runtime/plugin-runtime/tests/**`, `packages/runtime/plugin-tanstack/tests/**`, and `tests/integration/routes-tanstack*`.

## Constraints

Do not keep deprecated TanStack fields in our own UltraModern path. If upstream compatibility requires a shim later, it must be isolated and justified separately, not baked into the new product surface.

Do not regress React Router compatibility while removing TanStack-specific baggage. Generic router fields should serve both router lanes.

## Operator Guidance

Run this only after the latest TanStack dependency lane is green. New TanStack API breakages should be fixed in the plugin package, not papered over with deprecated `tanstack*` fields.

The success signal is simple: code and tests should speak in generic router runtime terms, while user-facing TanStack imports come from `@modern-js/plugin-tanstack`.
