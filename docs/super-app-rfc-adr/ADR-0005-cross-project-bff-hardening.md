# ADR-0005: Cross-Project BFF Hardening

- Status: Proposed
- Date: 2026-02-21
- Decision Type: Reliability and DX hardening

## 1. Context

Cross-project BFF already generates SDK, runtime, and plugin artifacts. Current behavior is functional, but there are avoidable error-prone paths around config override, package metadata mutation, bootstrap sequencing, and watch coverage.

## 2. Decision

Harden cross-project BFF with fail-fast validation, safer generation, and explicit bootstrap/runtime contracts.

## 3. Key Changes

1. Promote prefix conflicts from warning to build-time error.
2. Add explicit consumer bootstrap (`initProducerClient`) requirement and guard.
3. Make generated metadata merge deterministic and conflict-aware.
4. Add runtime compatibility checks (`hono`/`effect` expectations).
5. Expand file-watch coverage for SDK regeneration.

## 4. Implementation Plan

1. Validation:
  - enforce prefix policy during compile/startup
  - provide actionable error messages
2. SDK bootstrap contract:
  - generate typed init function
  - fail early if API called before initialization
3. Metadata safety:
  - introduce deterministic merge utility for `package.json` exports/types/files
  - detect collisions and fail fast
4. Runtime compatibility:
  - include producer runtime metadata in generated package
  - verify on consumer startup
5. Watch robustness:
  - include more source extensions and relevant generated artifacts
  - add stale-generation detection
6. Testing:
  - integration tests for conflict/failure scenarios
  - ensure cross-project happy path remains stable

## 5. Parallelization

- Execution mode: Parallel, should start early.
- Depends on: None.
- Blocks:
  - ADR-0002 implementation stage.
  - ADR-0003 final integration assumptions.

## 6. Acceptance Criteria

- Prefix conflict produces hard error, not warning.
- Consumer API usage before bootstrap fails with clear typed error.
- Metadata collision is detected and surfaced deterministically.
- Regeneration updates SDK reliably for supported source changes.
