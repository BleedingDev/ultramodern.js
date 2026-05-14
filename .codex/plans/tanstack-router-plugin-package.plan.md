---
name: TanStack Router Plugin Package
overview: Extract TanStack Router CLI and runtime integration into @modern-js/plugin-tanstack using the generic core hooks instead of embedding TanStack inside @modern-js/runtime.
todos:
  - id: tplug-01
    content: Scaffold @modern-js/plugin-tanstack from the PR #8317 prototype and current branch behavior, including package metadata, build config, exports, and tests.
    status: pending
  - id: tplug-02
    content: Move TanStack route generation, register file generation, route type generation, loader/action static-data handoff, and file-change regeneration into the plugin CLI.
    status: pending
  - id: tplug-03
    content: Move TanStack runtime exports, RouterProvider wiring, prefetch links, Form/useFetcher, route-tree conversion, and plugin hooks into @modern-js/plugin-tanstack/runtime.
    status: pending
  - id: tplug-04
    content: Wire create templates and TanStack fixtures to enable tanstackRouterPlugin(...) explicitly without relying on @modern-js/runtime/tanstack-router as the primary path.
    status: pending
  - id: tplug-05
    content: Add plugin package build, type, unit, and fixture contract verification while preserving React Router as the built-in Modern.js router path.
    status: pending
isProject: false
---

# TanStack Router Plugin Package

## Execution Notes

This plan implements the shape ByteDance requested in PR #8317: `import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack'` and `plugins: [tanstackRouterPlugin(...)]`.

The old PR branch already has a prototype package at `packages/runtime/plugin-tanstack`. Use it as source material, but reconcile it with the current branch, especially the already-landed `modernRouteAction` static-data bridge and Effect/Micro Vertical constraints.

The plugin should own TanStack dependencies, generated code imports, runtime exports, runtime hooks, and fixture activation. Core should only expose the generic hooks from the upstream plan.

## Constraints

Do not reintroduce TanStack package dependencies into `@modern-js/runtime` core.

Do not create `presetMicroVerticals`; this remains compatible with the single `presetUltramodern` direction.

Do not add migration/codemod work. If compatibility aliases are needed, keep them minimal and explicitly temporary, or defer them to a separate issue.

Do not mix Module Federation remote SSR implementation into this package extraction unless the core hooks and plugin base are already passing.

## Operator Guidance

Primary hotspots are `packages/runtime/plugin-tanstack/**`, `packages/runtime/plugin-runtime/package.json`, `packages/runtime/plugin-runtime/src/exports/tanstack-router.ts`, `packages/runtime/plugin-runtime/src/router/runtime/tanstack/**`, `packages/runtime/plugin-runtime/src/router/cli/code/tanstackTypes.ts`, `packages/toolkit/create/**`, `tests/integration/routes-tanstack/**`, and `tests/integration/routes-tanstack-create-routes/**`.

Preferred verification starts with plugin unit tests and build, then TanStack route integration fixtures, then create-template coverage.
