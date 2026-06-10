---
name: ultramodern-public-web-deepen-00-research
overview: Build evidence-backed understanding of the recent UltraModern public-web create pipeline before changing implementation, covering route path semantics, public-web artifact generation, policy defaults, Cloudflare proof helpers, and generated-output tests.
todos:
  - id: map-current-public-web-flow
    content: Trace current public-web create flow from workspace/app generation through route metadata, head rendering, public surface asset generation, Cloudflare proof generation, and integration tests.
    status: completed
  - id: identify-stable-contracts
    content: Identify generated contracts, CLI flags, env vars, file paths, assertion names, private-first behavior, and provider compatibility that must remain stable during deepening.
    status: completed
  - id: choose-first-implementation-seam
    content: Decide which deepening lane can start first with the smallest behavior-preserving diff and list the files it may edit.
    status: completed
isProject: false
---

# ultramodern-public-web-deepen-00-research

## Execution Notes

This plan is the required `codebase-deep-research` gate before implementation. It should verify the architecture-review findings against current source, tests, docs, ADRs, and recent commit history.

The research target is the create package public-web pipeline in `packages/toolkit/create/src/ultramodern-workspace.ts` and the integration coverage in `tests/integration/create-ultramodern-workspace/tests/index.test.ts`.

## Constraints

Do not edit implementation during this research plan. Preserve ADR-0016: no broad `webSpec`, profile, certification engine, app-level shims, route wrappers, or generated suppressions. Public surfaces remain private-first.

## Operator Guidance

Use read-only explorers for separate angles: route path semantics, policy/proof generation, tests/contracts, and history/ADR constraints. The primary agent owns synthesis and the decision on the first implementation seam.
