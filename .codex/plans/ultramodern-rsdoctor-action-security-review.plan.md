---
name: ultramodern-rsdoctor-action-security-review
overview: Independently review the generated RsDoctor Action design for permissions, secret exposure, pinned actions, fork PR behavior, and optional AI risk before final integration.
todos:
  - id: review-workflow-threat-model
    content: Check the planned generated workflow for pull_request_target avoidance, scoped permissions, pinned actions, and safe fork PR behavior.
    status: pending
  - id: review-ai-privacy-risk
    content: Check the optional AI path for secret handling, non-gating behavior, provider model clarity, and report privacy guidance.
    status: pending
  - id: return-actionable-findings
    content: Return concrete pass or fail findings with file references and exact recommended changes.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-action-security-review

## Execution Notes

This is a verification-only sidecar. It should run independently while write-capable lanes are active and challenge the CI/AI design before final validation.

Shared graph contract:

- No `pull_request_target`.
- Pinned action SHAs are preferred.
- Secrets are optional and unavailable to untrusted fork PR code.
- AI summaries are not quality gates.
- The workflow should request only the permissions required for PR comments and bundle baseline artifacts.

## Ownership

In scope:

- Read-only review of generated workflow templates, generated docs, and official RsDoctor Action assumptions.

Out of scope:

- Editing any source file.
- Running broad repo gates.
- Redesigning the whole CI system.

## Stop Condition

Stop when there is a concise pass/fail review with concrete file references and any required corrections. If official docs are ambiguous, return the ambiguity and the safest low-impact default.

## Verification

Prefer local static inspection plus actionlint if the generated workflow can be rendered cheaply. Do not require AI secrets to verify this lane.

