---
name: Ultramodern SuperApp Contract Doctor
overview: Add a fast diagnostic command that validates an UltraModern workspace before real SuperApp code is written.
todos:
  - id: usdoc-01
    content: Define doctor checks for presetUltramodern, @modern-js/plugin-tanstack, latest TanStack versions, Effect services, MF topology, design-system remote policy, ownership metadata, and shared-package boundaries.
    status: completed
  - id: usdoc-02
    content: Implement human-readable and JSON doctor output by reusing existing topology, template manifest, design-system, dependency, and release-gate validators.
    status: completed
  - id: usdoc-03
    content: Add actionable fix suggestions for stale TanStack versions, deprecated TanStack runtime fields, missing topology metadata, missing MF SSR flags, missing Effect request-context propagation, and forbidden shared-package roles.
    status: completed
  - id: usdoc-04
    content: Wire doctor checks into generated workspace scripts and the preflight CI profile.
    status: completed
isProject: false
---

# Ultramodern SuperApp Contract Doctor

## Execution Notes

This lane should make framework mistakes visible before teams write app-specific code. It should reuse validators rather than duplicate rules: topology validation, design-system checks, template manifest checks, dependency checks, and release-gate evidence should remain the source of truth.

Primary hotspots include `scripts/mv-integration-pilot/reference-topology.js`, `packages/solutions/app-tools/src/ultramodern/designSystem.ts`, `packages/toolkit/create/src/index.ts`, release-gate scripts under `scripts/release-gates/**`, and generated workspace package scripts.

## Constraints

The doctor should not mutate files by default. It may print fix suggestions and optionally support later explicit fix modes, but this plan should keep the first implementation diagnostic-only.

Do not add AI, MCP, migration, or codemod behavior here.

## Completion Evidence

Implemented `scripts/ultramodern-contract-doctor/run-contract-doctor.js` with human/JSON output, generated-workspace topology checks, latest TanStack version checks, deprecated TanStack marker detection, Effect service checks, and shared-package boundary checks.

Verified with `pnpm exec biome check --files-ignore-unknown=true scripts/ultramodern-contract-doctor/run-contract-doctor.js scripts/ultramodern-contract-doctor/__tests__/run-contract-doctor.test.js` and `node --test scripts/ultramodern-contract-doctor/__tests__/run-contract-doctor.test.js`.

## Operator Guidance

Run this in parallel with local-control-plane once the generator is available. The doctor should become the fast failure surface, while the local control plane proves runtime startup and teardown.
