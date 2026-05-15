---
name: Ultramodern Next MV Preset Topology
overview: Productize the narrowed Micro Verticals path under the single presetUltramodern entrypoint with a minimal topology covering shell, vertical remotes, a design-system remote, and Effect services.
todos:
  - id: unmtp-01
    content: Normalize docs and plan language so presetUltramodern is the only Micro Verticals preset and no second preset or migration program is implied.
    status: completed
  - id: unmtp-02
    content: Define the minimal topology fixture for one shell, two vertical remotes, one horizontal design-system MF remote, and one Effect service.
    status: completed
  - id: unmtp-03
    content: Wire the design-system path as just another Module Federation remote with the same trust, version, fallback, and SSR compatibility expectations as feature remotes.
    status: completed
  - id: unmtp-04
    content: Produce one reference workspace smoke path and graph handoff bundle that can feed plan-graph and subagent-graph without pulling in deferred work.
    status: completed
isProject: false
---

# Ultramodern Next MV Preset Topology

## Execution Notes

This plan is the productization layer after the Effect and TanStack/MF SSR critical paths are stable. It should make the framework easy to explain and launch: one preset, one topology, one shell, vertical remotes, a design-system remote, and Effect services.

The design system is not a special framework subsystem. Treat it as a horizontal Module Federation remote, similar to an RsLib-built UI library that can be exposed and consumed through the same trust and fallback mechanisms as feature remotes.

`unmtp-01` is complete after public docs and workspace guidance were tightened around the single `presetUltramodern(...)` entrypoint and migration/codemod guidance was explicitly kept out of this framework topology scope.

`unmtp-02` and `unmtp-03` are complete through the reference topology fixture and validator: `scripts/mv-integration-pilot/__fixtures__/reference-topology.json` now names `presetUltramodern`, carries exactly one shell, two vertical MF remotes, one horizontal design-system MF remote, and one Effect service, and validates MF SSR, compatibility digest, fallback telemetry, trust/artifact metadata, LKG, revocation, and ownership metadata for every remote.

`unmtp-04` is complete with `pnpm run validate:mv-topology-smoke` and the graph handoff bundle at `docs/super-app-rfc-adr/evidence/mv-topology-smoke/current/graph-handoff.json`.

## Constraints

Do not create `presetMicroVerticals`; `presetUltramodern` is the Micro Verticals preset. Avoid alias work unless explicitly requested later.

Do not include AI/MCP/agent operations. If coding-agent workflow guidance is needed later, document it externally as a repository workflow recommendation, not as framework runtime scope.

Do not include migration guides or codemods in this phase. Existing-app migration is explicitly deferred.

## Operator Guidance

Primary hotspots are `packages/solutions/app-tools/src/presetUltramodern.ts`, `packages/solutions/app-tools/src/baseline.ts`, `packages/toolkit/create/**`, `docs/super-app-rfc-adr/WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`, `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md`, `docs/super-app-rfc-adr/ADR-0013-mv-ds-platform-contract.md`, `scripts/mv-integration-pilot/**`, and `tests/integration/routes-tanstack-mf/**`.

Acceptance should be one small executable reference path, not a new broad adoption program.
