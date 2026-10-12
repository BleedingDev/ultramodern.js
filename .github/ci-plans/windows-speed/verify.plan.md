---
name: Windows CI validation
overview: Integrate both independent changes, review safety and coverage, then measure the complete optimized pipeline in the same PR.
todos:
  - id: validate-integrated-change
    content: Run focused coverage/cache regressions, lint workflows and obtain an independent change review.
    status: completed
  - id: measure-candidate
    content: Push the candidate after baseline completion and compare all fresh pipeline runs and required checks.
    status: in_progress
  - id: handoff-one-pr
    content: Record measured results and limitations in the PR, refresh the graph and return the separate PR.
    status: pending
isProject: false
---

# Windows CI validation

## Execution Notes

Both implementation lanes feed this validation lane. The verification result can first be seeded after this PR merges to trusted main. This pre-merge comparison measures test distribution with a verification-cache miss; it cannot quantify the future warm-cache gain. Do not treat a cold miss as a warm benchmark or claim projected savings as measured results.

## Constraints

Report the full pipeline, including the Windows integration floor, startup delays, failures, retries and aggregate checks. Verify application/test inputs match between baseline and candidate apart from the intended CI selection changes. Never infer green from old same-SHA checks. Keep the PR unmerged for user review.

## Operator Guidance

Root owns integration, graph updates, PR publication and evidence synthesis. A read-only reviewer checks coverage and cache trust boundaries. T3's app-owned PR watcher handles asynchronous CI completion. No extra benchmark PRs or top-level threads.
