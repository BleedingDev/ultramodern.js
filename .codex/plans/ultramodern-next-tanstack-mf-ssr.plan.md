---
name: Ultramodern Next TanStack MF SSR Contract
overview: Make TanStack Router plus Module Federation SSR the executable shell-to-remote contract for Micro Verticals, including hydration, redirects, not-found, loader/action handoff, fallback, and version-skew behavior.
todos:
  - id: untms-01
    content: Inventory the current TanStack MF SSR coverage against hydration, dehydrate, redirect, notFound, loader/action, asset ownership, and fallback requirements.
    status: completed
  - id: untms-02
    content: Convert the shell-to-remote SSR contract into executable fixtures for a shell route subtree backed by independently built TanStack MF remotes.
    status: pending
  - id: untms-03
    content: Add version-skew, remote-unavailable, compatibility-mismatch, and SSR-to-CSR degradation tests with observable fallback telemetry.
    status: pending
  - id: untms-04
    content: Tighten runtime flags and docs so app-level MF SSR is explicit, deterministic, and not hidden behind preset-only policy.
    status: pending
isProject: false
---

# Ultramodern Next TanStack MF SSR Contract

## Execution Notes

This is the central frontend runtime lane for Micro Verticals. A vertical is only credible when a shell can SSR a route subtree owned by a remote, hydrate it deterministically, and degrade predictably when the remote is unavailable or incompatible.

The first todo is intentionally investigative and should produce a small gap matrix before implementation. The implementation todos should stay focused on TanStack plus Module Federation SSR. React Router remains a compatibility lane and should not drive this plan.

Current investigation already found one high-risk gap to validate first: the TanStack SSR runtime exists, but the `routes-tanstack-mf` fixture currently treats federated route content as client-rendered during SSR. Promotion work must prove whether this is intentional fallback behavior or missing remote SSR coverage.

`untms-01` is complete after adding an executable gap matrix in `tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts` and a focused report in `.codex/reports/routes-tanstack-mf-ssr-gap-matrix-20260514.md`. The matrix keeps `federated-content-ssr` marked as a gap, records TanStack hydration/dehydrate as covered runtime surface, proves loader and generated action static-data handoff, and preserves remote fallback plus manifest singleton/version-skew evidence.

## Constraints

Keep scope to TanStack Router, Module Federation, SSR, hydration, loader/action semantics, fallback, and telemetry.

Do not add migration, codemod, AI, MCP, agent-operation, product taxonomy, or alternate-preset work.

Do not redesign Module Federation. Use the existing Modern.js/MF runtime surfaces and make the Micro Vertical contract executable.

## Operator Guidance

Primary hotspots are `packages/runtime/plugin-runtime/src/exports/tanstack-router.ts`, `packages/runtime/plugin-runtime/src/router/runtime/tanstack/**`, `packages/runtime/plugin-runtime/src/router/cli/code/**`, `packages/server/prod-server/src/libs/render/**`, `tests/integration/routes-tanstack-mf/**`, and any existing MF SSR contract tests.

This plan can run in parallel with Effect service work, but shared runtime flags and public docs should be integrated only once both sides are understood.
