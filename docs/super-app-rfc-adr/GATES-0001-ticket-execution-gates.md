# GATES-0001: Mandatory Ticket Execution Gates

- Status: Active
- Date: 2026-02-22
- Related Beads: `modernjs-44t.1.2`
- Scope: Uniform done-criteria for all Super-App Foundation tickets

## 1. Purpose

This document defines the mandatory execution gates for every Beads ticket in the `modernjs-44t` program.

Goals:

1. Keep implementation quality consistent.
2. Prevent silent regressions and under-validated merges.
3. Enforce Effect-first and TanStack-first defaults while preserving compatibility lanes.

## 2. Gate Model

Every ticket must pass all gates in order.

## Gate A: Architecture Scope Review (Required First)

Required artifacts:

1. Scope statement mapped to target architecture (`ARCH-0001` + relevant ADRs).
2. Out-of-scope statement (what this ticket explicitly does not change).
3. Compatibility-lane impact assessment (Hono / React Router only if needed).

Pass criteria:

1. No conflict with Effect-first and TanStack-first defaults.
2. No hidden coupling that breaks independent deployability of MF apps.
3. Risks and rollback strategy are documented.

Acceptance checklist (must be attached to ticket comments or linked docs):

1. Scope and out-of-scope text is approved by architecture reviewer (name + date).
2. Relevant ADR/RFC links are present and point to exact sections.
3. Compatibility lane impact is explicitly marked:
   - `Not applicable`, or
   - `Compatibility lane change` with rationale.
4. Risk and rollback note includes trigger + rollback command/path.

## Gate B: Implementation Validation

Required artifacts:

1. Implementation evidence (code paths, config surface, behavior change summary).
2. Runtime behavior proof for positive and negative paths.
3. Backward-compatibility impact statement for existing Modern.js v3 behaviors.

Pass criteria:

1. Behavior is deterministic and fail-fast where contract violations occur.
2. Validation outputs are attached (logs, build output, or reproducible commands).
3. No undocumented feature-flag or env behavior is introduced.

Acceptance checklist (must be attached to ticket comments or linked docs):

1. Behavior change summary includes positive and negative paths.
2. Validation command list is reproducible and complete.
3. Output excerpt confirms pass/fail expectations for each validation command.
4. Compatibility impact statement confirms whether Modern.js v3 behavior changes.

## Gate C: Testing Proof

Required artifacts:

1. Updated/added tests covering new behavior and regressions.
2. Commands used for verification.
3. Any known gaps explicitly listed with follow-up tickets.

Pass criteria:

1. Relevant tests pass locally/CI for modified scope.
2. Negative-path coverage exists for security/reliability sensitive changes.
3. Test fixtures/contracts remain stable for unaffected lanes.

Acceptance checklist (must be attached to ticket comments or linked docs):

1. Test inventory lists added, updated, and intentionally omitted coverage.
2. Commands are documented with exact package/filter/target.
3. Result summary includes pass status and any known flaky risk.
4. Every known gap has a follow-up Beads ticket ID.

## Gate D: Final Review (>=2 Subagents)

Required artifacts:

1. At least two independent subagent reviews.
2. Findings log with status for each finding:
   - Accepted and fixed
   - Deferred with explicit follow-up
   - Rejected with rationale

Pass criteria:

1. No unresolved high-risk findings.
2. Review logs are persisted in docs and/or ticket comments.
3. Ticket has explicit close reason referencing validation evidence.

Acceptance checklist (must be attached to ticket comments or linked docs):

1. Reviewer A record includes reviewer ID/name, timestamp, and findings summary.
2. Reviewer B record includes reviewer ID/name, timestamp, and findings summary.
3. Each finding is marked `fixed`, `deferred`, or `rejected` with rationale.
4. Deferred findings include follow-up ticket IDs.
5. Final close comment links Gate B and Gate C evidence artifacts.

## 3. Ticket Template (Copy-Paste)

Use this structure in ticket notes/comments:

```md
## Gate A: Architecture Scope Review
- Scope:
- Out-of-scope:
- Architecture/ADR links:
- Compatibility lane impact:
- Risk + rollback notes:

## Gate B: Implementation Validation
- What changed:
- Behavior validation commands:
- Validation outputs:
- Backward compatibility notes:

## Gate C: Testing Proof
- Added/updated tests:
- Test commands:
- Results:
- Known gaps + follow-ups:

## Gate D: Final Review (>=2 Subagents)
- Reviewer 1 findings:
- Reviewer 2 findings:
- Resolutions:
- Residual risk:
```

## 4. Enforcement Rules

1. Ticket cannot be closed unless Gates A-D are all satisfied.
2. Missing test evidence blocks closure even if implementation exists.
3. Missing two-subagent review blocks closure even for docs-only governance tickets.
4. Compatibility-only changes must be tagged and cannot redefine default lanes.
5. Gate evidence must be timestamped and attributable to specific reviewers/authors.

## 4.1 Enforcement Ownership Model

1. Ticket owner prepares gate evidence artifacts (A-D) and links them in ticket comments.
2. Gate steward for the active stream verifies checklists and marks gate status as complete.
3. CI gate mapping (`modernjs-44t.1.2.1`) is the required automation source for objective checks:
   - build/test command success,
   - artifact presence,
   - reviewer evidence fields.
   - canonical mapping source: `CI-GATES-0001-check-and-artifact-map.md`.
4. Release coordinator must refuse promotion when Gate D evidence is incomplete.
5. Any waived rule requires explicit waiver comment with approver identity and expiry date.

## 5. Exit Criteria For GATES-0001

1. This document is linked from the RFC/ADR index.
2. Ticket `modernjs-44t.1.2` references this as canonical gate policy.
3. Downstream CI mapping ticket (`modernjs-44t.1.2.1`) consumes this gate model.
