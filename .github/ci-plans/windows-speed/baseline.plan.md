---
name: Windows CI baseline
overview: Freeze the source and start the unoptimized full PR pipeline before either implementation lane changes CI.
todos:
  - id: freeze-source
    content: Create the separate branch from main-ultramodern and record its base commit.
    status: completed
  - id: baseline-run
    content: Open the single PR with this plan and capture its fresh workflow run IDs.
    status: pending
isProject: false
---

# Windows CI baseline

## Execution Notes

Base commit is `1e888a08394b43e769b658df5f05a24f37e46d0a`. The initial PR commit changes only these plans. Collect full event-to-required-check completion, per-job execution, install/build/test durations, cache outcomes and retries. Compare the optimized revision against this run; preserve the distinction between measurements and projections.

## Constraints

Use one PR against `main-ultramodern` in `ultramodernjs/ultramodern.js`. Do not change runner labels, toolchain, lockfile, tests, branch protection or billing settings. Wait for baseline completion before pushing the candidate so concurrency does not cancel it.

## Operator Guidance

Root owns branch, commits, PR and measurements. Beads issue `modernjs-0v9rk.6` tracks the task; plan statuses project execution progress. Native agents may start the two implementation lanes once the baseline run IDs are recorded.
