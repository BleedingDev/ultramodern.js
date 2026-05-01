---
name: UltraModern SuperApp Torture Destroy Readiness
overview: Combine load, k6, autocannon, chaos, browser, contracts, runtime matrix, and soak evidence into one automated destroy-run certification and a release decision report.
todos:
  - id: ust-destroy-01
    content: "Define the destroy-run command that builds, serves, warms up, runs load, runs chaos, runs browser smoke during load, runs contracts, runs runtime matrix checks, and tears down cleanly."
    status: completed
  - id: ust-destroy-02
    content: "Add release, nightly, and manual-torture profiles with explicit thresholds for p95, p99, max latency, error rate, event-loop delay, memory drift, browser errors, and contract failures."
    status: completed
  - id: ust-destroy-03
    content: "Aggregate all lane artifacts into a single readiness JSON and markdown report with pass, warning, fail, and unknown classifications."
    status: completed
  - id: ust-destroy-04
    content: "Run at least one full destroy-run locally, record the observed limits, fix actionable failures in scope, and file beads issues for any remaining work."
    status: completed
  - id: ust-destroy-05
    content: "Document the final go/no-go criteria for starting a large ERP or Uber/Grab-style SuperApp on the fork."
    status: pending
isProject: true
---

# UltraModern SuperApp Torture Destroy Readiness

## Execution Notes

This is the terminal lane. It should not invent new coverage except for orchestration and aggregation gaps. Its job is to compose the evidence from all upstream lanes into a decision that is hard to misunderstand.

The destroy run should be intentionally harsh but deterministic. It should try to overload, break, recover, and revalidate the app while preserving artifacts for every phase.

The readiness report should distinguish hard failures from unknowns. If k6 is unavailable, if a browser artifact is missing, or if a soak was skipped, the final report should say that explicitly instead of silently passing.

## Constraints

Do not turn manual overnight profiles into default PR blockers. Keep profile cost visible and intentional.

Do not push to upstream `origin`. If remote work is needed, use the user's fork remote.

Do not manually edit lockfiles.

## Operator Guidance

Suggested ownership is certification orchestration, readiness aggregation, final markdown reports, and beads follow-up issues.

Conflict risk is broad because this lane touches profile wiring and report aggregation. Wait for upstream lanes to stabilize artifact schemas before heavy edits.

Exit criteria: one documented command can produce a final SuperApp readiness verdict backed by artifacts from load, chaos, contracts, browser, runtime, and soak validation.
