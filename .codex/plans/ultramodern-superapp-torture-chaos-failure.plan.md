---
name: UltraModern SuperApp Torture Chaos Failure
overview: Add a comprehensive failure-injection matrix for downstream timeouts, malformed remotes, tenant violations, retry storms, partial module failure, slow chat streams, and recovery paths.
todos:
  - id: ust-chaos-01
    content: "Define a failure taxonomy covering downstream timeout, partial module error, stale remote manifest, down remote, malformed JSON, auth expiry, tenant violation, retry storm, slow stream, and duplicate request."
    status: pending
  - id: ust-chaos-02
    content: "Add deterministic failure toggles to the SuperApp portfolio fixture without leaking chaos behavior into normal scenarios."
    status: pending
  - id: ust-chaos-03
    content: "Assert error-envelope shape, requestId propagation, cleanup/finalizer behavior, and tenant-safe failure responses for every failure mode."
    status: pending
  - id: ust-chaos-04
    content: "Run chaos modes under moderate load and verify no failure mode poisons later healthy requests after reset."
    status: pending
  - id: ust-chaos-05
    content: "Emit a chaos matrix artifact with scenario, injected fault, expected status, actual status, cleanup result, and telemetry redaction result."
    status: pending
isProject: true
---

# UltraModern SuperApp Torture Chaos Failure

## Execution Notes

This lane proves the SuperApp architecture fails predictably. The goal is not just to receive errors; it is to verify isolation, cleanup, request classification, and recovery.

Chaos scenarios should be deterministic and addressable through test-only scenario inputs. They should cover both API/BFF behavior and Module Federation or SSR-facing failure modes where practical.

The most important assertion is that a bad tenant, module, stream, manifest, or retry storm cannot corrupt shared state or poison healthy follow-up requests.

## Constraints

Failure injection must not affect ordinary release smoke paths unless explicitly enabled. Avoid global mutable switches that can leak across concurrent tests.

Do not weaken application errors into generic catch-all responses if doing so hides contract details needed by callers.

## Operator Guidance

Suggested ownership is portfolio BFF handlers, scenario toggles, failure fixtures, and chaos-specific validation tests.

Conflict risk is highest with workload-data scenario definitions and Effect/TanStack contract tests. Stabilize fault identifiers and expected error envelopes before downstream lanes depend on them.

Exit criteria: each injected failure has a deterministic repro, expected contract, artifact row, and post-reset healthy verification.
