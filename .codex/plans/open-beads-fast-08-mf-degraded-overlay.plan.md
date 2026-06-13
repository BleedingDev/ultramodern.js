---
name: open-beads-fast-08-mf-degraded-overlay
overview: "Finish modernjs-a6d4.4 and modernjs-e2pq by wiring Module Federation degraded-state telemetry and proving boundary overlay layout stability."
todos:
  - id: inventory-mf-fallback-signals
    content: "Inventory runtime fallback signal ingestion, generated MF fallback UI/state, trust policy checks, compatibility checks, and current boundary overlay controls."
    status: completed
  - id: wire-mf-degraded-telemetry
    content: "Emit deterministic degraded-state telemetry from framework/template-owned MF fallback paths with appName, entry, phase, reason, runtime digest, and recovery/failure events while preserving trust checks."
    status: completed
  - id: add-mf-fallback-tests
    content: "Add unit or integration tests proving MF fallback states do not bypass trust/compatibility checks and emit telemetry consistently."
    status: completed
  - id: add-boundary-overlay-browser-validation
    content: "Add generated-app browser validation that toggling module boundaries preserves scroll height and primary control bounding boxes, and Checkout controls inside Decide surfaces are marked as Checkout boundaries."
    status: completed
  - id: run-mf-focused-validation
    content: "Run routes-tanstack-mf, boundary overlay, runtime fallback telemetry, and relevant superapp contract tests serially where fixture sharing requires it."
    status: completed
  - id: close-mf-telemetry-overlay-beads
    content: "Update and close modernjs-a6d4.4 and modernjs-e2pq with validation evidence."
    status: completed
isProject: false
---

# open-beads-fast-08-mf-degraded-overlay

## Execution Notes

This lane covers both runtime degraded-state telemetry and browser-visible boundary overlay stability. It should coordinate with `open-beads-fast-02-mf-fixture-contracts` so tests do not depend on stale `@mf-types` artifacts or broad app shims.

Primary Beads: `modernjs-a6d4.4` and `modernjs-e2pq`. Excluded by user direction: `modernjs-4fq2`; do not add mixed-bundler proof because Rspack is the chosen lane.

## Constraints

Do not bypass MF trust, compatibility, digest, SRI, provenance, or fallback checks. Do not assert source-code text for overlay validation. Keep browser validation focused on layout geometry and ownership rendering.

## Operator Guidance

Assign one subagent to this lane. It can start immediately on fallback telemetry inventory/tests, but should sync with the MF fixture agent before final integration. Run race-prone integration suites serially.
