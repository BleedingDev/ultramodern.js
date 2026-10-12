---
name: Windows CI validation
overview: Integrate both independent changes, review safety and coverage, then measure the complete optimized pipeline in the same PR.
todos:
  - id: validate-integrated-change
    content: Run focused coverage/cache regressions, lint workflows and obtain an independent change review.
    status: completed
  - id: measure-candidate
    content: Push the candidate after baseline completion and compare all fresh pipeline runs and required checks.
    status: completed
  - id: handoff-one-pr
    content: Record measured results and limitations, refresh the graph and publish the final changes in the separate PR.
    status: completed
isProject: false
---

# Windows CI validation

## Execution Notes

Both implementation lanes feed this validation lane. The verification result can first be seeded after this PR merges to trusted main. This pre-merge comparison measures test distribution with a verification-cache miss; it cannot quantify the future warm-cache gain. Do not treat a cold miss as a warm benchmark or claim projected savings as measured results.

## Constraints

Report the full pipeline, including the Windows integration floor, startup delays, failures, retries and aggregate checks. Verify application/test inputs match between baseline and candidate apart from the intended CI selection changes. Never infer green from old same-SHA checks. Keep the PR unmerged for user review.

## Operator Guidance

Root owns integration, graph updates, PR publication and evidence synthesis. A read-only reviewer checks coverage and cache trust boundaries. T3's app-owned PR watcher handles asynchronous CI completion. No extra benchmark PRs or top-level threads.

## Measurement

Measured implementation revision is `72b23072d23170098a7f54ab8cf1e139e995c2b3`, against the same frozen application, test and toolchain inputs as the baseline. Windows unit run `38235702005` passed on attempt one with 603 identities, 4,975 passed tests and three existing skips. Its elapsed time improved from 671 to 605 seconds, while summed job execution increased from 2,355 to 2,704 seconds. The verification cache missed on every lane.

The complete pipeline finished at `2026-10-12T10:38:54Z`, 1,108 seconds after its earliest workflow event. This is slower than the 671-second baseline. All 30 required checks passed; their final completion was ten seconds earlier than the final legacy aggregate gate. macOS runners waited 481 to 654 seconds before job execution; a Windows integration dev-server context failure passed on one targeted retry. Include both queue time and retry in the full result. Unique executed job attempts consumed 9,336 seconds against the baseline's 8,455 seconds. This run does not establish an overall pipeline speedup or a warm verification-cache benefit.

The final assertion cleanup removes a redundant command-text check and passes all five focused workflow tests. It does not change the measured application tests, test selection, toolchain or cache behavior.
