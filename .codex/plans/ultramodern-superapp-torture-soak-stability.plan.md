---
name: UltraModern SuperApp Torture Soak Stability
overview: Run long-duration stability, memory, event-loop, reset-cycle, and mixed-workload tests that reveal leaks, latency drift, handle growth, GC pressure, and state corruption over time.
todos:
  - id: ust-soak-01
    content: "Create soak profiles for 15-minute local, 60-minute extended, and 2-to-6-hour overnight runs with configurable concurrency and scenario mix."
    status: completed
  - id: ust-soak-02
    content: "Track memory, heap, event-loop delay, request throughput, latency windows, open handles, reset success, and classified error rates over time."
    status: completed
  - id: ust-soak-03
    content: "Run mixed normal, write-heavy, chat, reset, chaos-lite, and tenant-boundary workloads for the duration profile."
    status: completed
  - id: ust-soak-04
    content: "Add drift detectors for memory growth, p95/p99 latency degradation, error-rate increases, stalled resets, and unreleased handles."
    status: pending
  - id: ust-soak-05
    content: "Emit soak artifacts and a markdown appendix with observed stability envelope, thresholds, and recommended fixes for any failure."
    status: pending
isProject: true
---

# UltraModern SuperApp Torture Soak Stability

## Execution Notes

This lane starts only after load, chaos, contract, and browser/runtime lanes have enough coverage to provide realistic scenario inputs. Its purpose is to detect problems that short runs cannot expose.

Use tiered profiles. A 15-minute local soak should be cheap enough for manual preflight. The 2-to-6-hour profile should be explicitly nightly/manual and produce enough detail for morning triage.

The run should not only report final totals. It should show time-window trends so a late-run degradation is visible even if final averages look acceptable.

## Constraints

Never hide intermittent errors by averaging them away. Preserve classified error samples, first occurrence time, and whether recovery succeeded.

Do not block normal release validation on overnight profiles. Release can require the latest passing soak artifact or a shorter soak gate; nightly owns the long-duration proof.

## Operator Guidance

Suggested ownership is soak runner orchestration, metric drift detection, and nightly profile wiring.

Conflict risk is high with load and harness scripts. Reuse the shared server controller, samplers, and artifact schema.

Exit criteria: we know whether SuperApp behavior remains stable over time, and failures point to memory, latency, handle, reset, or error-class drift rather than a vague timeout.
