---
name: Windows test distribution
overview: Separate measured expensive generator tests from ordinary Windows shards while retaining exact test coverage.
todos:
  - id: implement-test-split
    content: Isolate expensive generator files and retain deterministic native sharding for the remaining tests.
    status: pending
  - id: verify-test-coverage
    content: Prove disjoint complete project-file discovery and choose a bounded worker trial for ordinary tests.
    status: pending
isProject: false
---

# Windows test distribution

## Execution Notes

The existing four file-count shards place `add-shell.test.ts` and `workspace-integration.test.ts` together. Prefer a small include/exclude split using the existing runner over a custom duration scheduler. The generator lane keeps one file worker. Consider two workers for ordinary tests only after checking shared resources and all generator membership.

## Constraints

Every original discovered `(project, file)` identity must appear exactly once. Do not remove tests, raise timeouts, change assertions, weaken the `ut-windows` gate or modify runtime packages. Preserve Linux and macOS test behavior. Worker changes must be explicit and measured; retain one worker if the trial is unreliable or slower.

## Operator Guidance

Test worker owns Windows test selection, coverage regression checks and `ut-Windows.yml`; root alone integrates the cache action into that workflow afterward. Cache worker must not edit the Windows unit workflow. Report ordinary/generator worker limits and verification evidence; do not commit.
