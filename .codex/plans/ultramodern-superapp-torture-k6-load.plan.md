---
name: UltraModern SuperApp Torture K6 Load
overview: Add independent load-generation capability with k6 and extended autocannon coverage so SuperApp HTTP boundaries are measured beyond the current same-machine Node fetch runner.
todos:
  - id: ust-load-01
    content: "Resolve the local k6 execution path or add a documented fallback runner that does not depend on an unconfigured proto plugin."
    status: completed
  - id: ust-load-02
    content: "Create k6 scenarios for smoke, ramp-up, spike, breakpoint, mixed read/write, tenant-boundary, chat, reset, and chaos-triggering workloads."
    status: completed
  - id: ust-load-03
    content: "Run the app server and load generator as separate processes with configurable ports, CPU affinity notes, warmup, cooldown, and artifact capture."
    status: completed
  - id: ust-load-04
    content: "Add multi-worker autocannon probes for key GET and POST endpoints to distinguish server limits from client/socket limits."
    status: pending
  - id: ust-load-05
    content: "Promote stable release thresholds and more aggressive nightly thresholds into certification without increasing default PR cost."
    status: pending
isProject: true
---

# UltraModern SuperApp Torture K6 Load

## Execution Notes

This lane starts after harness telemetry and workload data exist. Its job is to replace vague high-concurrency confidence with repeatable, independently generated load evidence.

The first decision is how k6 runs locally. If proto remains unavailable, use a documented alternative such as a package-manager install path, Homebrew-installed binary, Docker-based k6 where available, or a skipped-with-actionable-diagnostic wrapper. The plan should not silently pretend k6 ran when it did not.

Autocannon remains useful because it is easy to run through `pnpm dlx`. Use it as a second perspective, especially for endpoint-specific saturation and connection behavior.

## Constraints

Do not manually edit lockfiles. Do not require k6 for fast PR validation until the local and CI installation path is reliable.

Separate server failures from load-client failures. Every summary should identify HTTP non-2xx, timeout, socket, fetch/client, and harness failures distinctly.

## Operator Guidance

Suggested ownership is `scripts/superapp-load`, new `scripts/superapp-k6` or adjacent runner code, and certification profile entries.

Conflict risk is high with the harness lane around artifact schemas. Reuse its schema instead of creating a load-only shape.

Exit criteria: one command can run k6-style and autocannon-style load against a production SuperApp server, produce comparable artifacts, and identify the first stable zero-error boundary plus the first observed failure boundary.
