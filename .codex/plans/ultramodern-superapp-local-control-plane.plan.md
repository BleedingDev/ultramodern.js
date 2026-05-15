---
name: Ultramodern SuperApp Local Control Plane
overview: Reuse existing SuperApp certification process-control machinery to run generated shell, remotes, design-system remote, and services locally with stable ports, readiness probes, logs, and teardown.
todos:
  - id: uslcp-01
    content: Extract reusable process, port, readiness, metrics, and teardown helpers from SuperApp certification without breaking destroy-run behavior.
    status: pending
  - id: uslcp-02
    content: Add local topology runner for generated UltraModern workspaces that starts services, remotes, design-system remote, and shell in dependency order.
    status: pending
  - id: uslcp-03
    content: Add rehearsal modes for remote unavailable, version skew, design-system bad release, and service unavailable using topology overlays.
    status: pending
  - id: uslcp-04
    content: Validate deterministic startup, failure classification, log and artifact output, and teardown in generated workspace fixtures.
    status: pending
isProject: false
---

# Ultramodern SuperApp Local Control Plane

## Execution Notes

Do not invent a second orchestration stack. The repo already has useful machinery in `scripts/superapp-certification/production-server-controller.js` and `scripts/superapp-destroy/run-superapp-destroy.js`. This lane should extract or wrap that machinery for generated workspaces.

The goal is local developer confidence: start every process, wait for health, capture logs, run basic smoke checks, and tear down cleanly.

## Constraints

Keep expensive destroy-run, release, nightly, and manual-torture profiles separate from local development. This lane should be cheap enough to run frequently.

Do not hardcode fixture ports into generated production topology. Local overlays may use stable ports, but topology metadata must remain environment-aware.

## Operator Guidance

Build this after the workspace generator exists. Use the generated workspace as the acceptance fixture so the runner proves the actual developer entrypoint, not only the existing `tests/integration/superapp-portfolio` fixture.
