---
name: Ultramodern MV Workspace Scaffolding
overview: Turn the completed single-preset Micro Vertical reference model into a canonical workspace, generator, and starter topology for shell apps, MF remotes, shared packages, and independent services.
todos:
  - id: umws-01
    content: Define the canonical repository and workspace topology for shell, remote, service, and shared-package ownership under presetUltramodern.
    status: pending
  - id: umws-02
    content: Extend create and generator surfaces so teams can scaffold shell, remote, service, and shared-package slices without inventing custom folder structures.
    status: pending
  - id: umws-03
    content: Add local-development orchestration guidance for running shell, remotes, and services together, including workspace-protocol flows and version-skew simulation.
    status: pending
  - id: umws-04
    content: Add reference starter and smoke-test coverage that proves generated MV workspace topology stays compatible with the completed router, MF, and BFF contract seams.
    status: pending
isProject: false
---

# Ultramodern MV Workspace Scaffolding

## Execution Notes

The framework foundation is complete, but teams still do not have a canonical answer for how to lay out a real Micro Vertical repo. This plan covers the missing adoption surface between the completed `presetUltramodern(...)` core and day-one developer ergonomics.

The output must not be a second framework mode. It should be a reference topology and generator surface that keeps the repo merge-friendly while making shell, remote, service, and shared-package boundaries explicit.

## Constraints

1. Keep `presetUltramodern(...)` as the single public opinionated entrypoint.
2. Reuse existing `@modern-js/create` and template surfaces instead of inventing a disconnected scaffolder.
3. Support both monorepo-local development and independently deployed runtime boundaries.
4. Keep workspace topology domain-neutral; ownership semantics belong to teams, not framework taxonomy.

## Operator Guidance

The plan should answer:

- what folders and packages exist in a canonical MV repo,
- what a shell package owns vs a remote package vs a service package,
- how local development composes them together,
- and how generated starters prove the arrangement stays aligned with TanStack, MF SSR, and Effect/Hono seams.

## References

- [docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md](/Users/satan/side/experiments/modernjs/docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md)
- [packages/toolkit/create/README.md](/Users/satan/side/experiments/modernjs/packages/toolkit/create/README.md)
- [packages/toolkit/create/template/README.md](/Users/satan/side/experiments/modernjs/packages/toolkit/create/template/README.md)
- [packages/toolkit/create/template/modern.config.ts.handlebars](/Users/satan/side/experiments/modernjs/packages/toolkit/create/template/modern.config.ts.handlebars)
- [tests/integration/routes-tanstack-mf](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf)
- [tests/integration/bff-runtime-parity](/Users/satan/side/experiments/modernjs/tests/integration/bff-runtime-parity)
