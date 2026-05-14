---
name: Ultramodern Next Effect Service Surface
overview: Make Effect v4 beta the first-class service and BFF contract surface for presetUltramodern Micro Verticals while keeping Hono only as an explicit compatibility lane.
todos:
  - id: unes-01
    content: Upgrade Effect v4 beta dependencies, refresh the lockfile, and record any source-level API breakages before broadening runtime changes.
    status: completed
  - id: unes-02
    content: Align the public BFF/service surface so new presetUltramodern services use Effect-first exports, generator defaults, and docs without removing explicit Hono compatibility.
    status: pending
  - id: unes-03
    content: Prove request, auth, tenant, locale, and trace propagation from shell or remote clients into Effect services across dev, build, and serve paths.
    status: pending
  - id: unes-04
    content: Add the minimal release-gate evidence that an Effect service can act as a Micro Vertical backend boundary without ad hoc header plumbing.
    status: pending
isProject: false
---

# Ultramodern Next Effect Service Surface

## Execution Notes

Effect v4 beta is an accepted dependency choice for this fork. The goal is not to debate the runtime. The goal is to make the Effect path the default service contract for our SuperApp framework and remove ambiguity where Hono-shaped naming still looks like the primary path.

`unes-01` is complete after upgrading `effect` and `@effect/opentelemetry` to `4.0.0-beta.66`, replacing the removed `effect/ServiceMap` type import with `effect/Context`, and verifying `@modern-js/plugin-bff` build plus tests in a clean detached worktree.

This plan should start with the dependency update because API churn can invalidate follow-up work. After the dependency is green enough, implementation should focus on the narrow public surface needed by Micro Verticals: generated clients, request-context propagation, service operation contracts, and release evidence.

## Constraints

Keep one preset only: `presetUltramodern` is the Micro Verticals preset. Do not introduce `presetMicroVerticals`.

Keep Hono available as an explicit compatibility lane, but do not let Hono naming or docs define the new default path.

Do not add AI, MCP, agent-operation, migration-guide, or codemod work to this plan.

## Operator Guidance

Primary hotspots are `packages/cli/plugin-bff/package.json`, `pnpm-lock.yaml`, `packages/cli/plugin-bff/src/runtime/effect/**`, `packages/cli/plugin-bff/src/runtime/data-platform/**`, `packages/cli/plugin-bff/src/utils/effectClientGenerator.ts`, and `packages/server/create-request/src/**`.

Verification should prefer targeted BFF and Effect tests before repo-wide gates. If the dependency upgrade exposes large source changes, stop after documenting the API deltas and split that work into a separate implementation lane.
