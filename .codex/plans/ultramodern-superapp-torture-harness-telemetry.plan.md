---
name: UltraModern SuperApp Torture Harness Telemetry
overview: Build the shared measurement, process-control, and artifact substrate for the next SuperApp torture validation wave so every later lane can run repeatably and report machine-readable evidence.
todos:
  - id: ust-harness-01
    content: "Inventory the current SuperApp portfolio load, certification, readiness, and report artifacts and document the canonical inputs each later lane must reuse."
    status: pending
  - id: ust-harness-02
    content: "Add a reusable production server controller that can launch, probe, health-check, and stop SuperApp fixtures without coupling load generation to the same process."
    status: pending
  - id: ust-harness-03
    content: "Add a process metrics sampler for rss, heap, event-loop delay, open handles, request totals, error classes, and per-scenario latency windows."
    status: pending
  - id: ust-harness-04
    content: "Standardize JSON artifact schemas for load, soak, browser, chaos, contract, runtime-matrix, and destroy-run outputs."
    status: pending
  - id: ust-harness-05
    content: "Wire every new harness path into certification artifact directories without changing default PR-time cost."
    status: pending
isProject: true
---

# UltraModern SuperApp Torture Harness Telemetry

## Execution Notes

This is the first root lane for the next validation wave. Its output is the shared evidence layer that later lanes consume instead of inventing one-off logs.

The production server controller should prefer existing Modern.js build and serve commands for `tests/integration/superapp-portfolio`. It must support configurable ports, readiness probes, timeouts, clean shutdown, and failure diagnostics. The controller must make it possible to run the app server and the load driver as separate processes.

The metrics sampler should be lightweight enough for release gates but detailed enough for nightly torture runs. It should emit periodic samples and a final summary with thresholds evaluated separately from raw evidence.

## Constraints

Do not manually edit any lockfile. If a dependency is required, add it through the package manager or prefer `pnpm dlx`/built-in Node APIs when the tool is only used for manual validation.

Keep default validation fast. Long-running probes must be opt-in via environment variables or nightly profiles.

Use machine-readable artifacts as the source of truth. Markdown reports should summarize artifacts, not replace them.

## Operator Guidance

Suggested ownership is `scripts/superapp-*`, `.codex/reports`, and certification harness code. Avoid touching SuperApp UI fixture behavior in this lane except where a health endpoint or fixture metadata is needed.

Conflict risk is highest with other lanes editing `scripts/superapp-certification/run-superapp-certification.js` or `scripts/superapp-load/run-superapp-load.js`. Treat this lane as the owner of shared schemas and process orchestration.

Exit criteria: later lanes can start a production SuperApp server, attach samplers, write artifacts into a stable directory shape, and classify failures without parsing terminal text.
