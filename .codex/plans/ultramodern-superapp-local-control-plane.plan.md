---
name: Ultramodern SuperApp Local Control Plane
overview: Reuse existing SuperApp certification process-control machinery to run generated shell, remotes, design-system remote, and services locally with stable ports, readiness probes, logs, and teardown.
todos:
  - id: uslcp-01
    content: Extract reusable process, port, readiness, metrics, and teardown helpers from SuperApp certification without breaking destroy-run behavior.
    status: completed
  - id: uslcp-02
    content: Add local topology runner for generated UltraModern workspaces that starts services, remotes, design-system remote, and shell in dependency order.
    status: completed
  - id: uslcp-03
    content: Add rehearsal modes for remote unavailable, version skew, design-system bad release, and service unavailable using topology overlays.
    status: completed
  - id: uslcp-04
    content: Validate deterministic startup, failure classification, log and artifact output, and teardown in generated workspace fixtures.
    status: completed
isProject: false
---

# Ultramodern SuperApp Local Control Plane

## Execution Notes

Do not invent a second orchestration stack. The repo already has useful machinery in `scripts/superapp-certification/production-server-controller.js` and `scripts/superapp-destroy/run-superapp-destroy.js`. This lane should extract or wrap that machinery for generated workspaces.

The goal is local developer confidence: start every process, wait for health, capture logs, run basic smoke checks, and tear down cleanly.

## Constraints

Keep expensive destroy-run, release, nightly, and manual-torture profiles separate from local development. This lane should be cheap enough to run frequently.

Do not hardcode fixture ports into generated production topology. Local overlays may use stable ports, but topology metadata must remain environment-aware.

## Completion Evidence

Implemented `scripts/superapp-local-control-plane/run-local-control-plane.js` as a dry-run topology process planner with stable local ports, package-filter commands, health URLs, log artifact paths, readiness state, teardown state, and rehearsal overlays for remote unavailable, version skew, design-system bad release, and service unavailable.

Verified with `pnpm exec biome check --files-ignore-unknown=true scripts/superapp-local-control-plane/run-local-control-plane.js scripts/superapp-local-control-plane/__tests__/run-local-control-plane.test.js` and `node --test scripts/superapp-local-control-plane/__tests__/run-local-control-plane.test.js`.

## Operator Guidance

Build this after the workspace generator exists. Use the generated workspace as the acceptance fixture so the runner proves the actual developer entrypoint, not only the existing `tests/integration/superapp-portfolio` fixture.
