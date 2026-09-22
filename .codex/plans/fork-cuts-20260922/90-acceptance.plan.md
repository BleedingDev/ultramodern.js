---
name: integrated-feature-parity
overview: "Integrate all cuts, verify actual consumer behavior and downstream Tractor acceptance, and report honest before/after architecture measurements."
todos:
  - id: integrated-feature-parity-integrate
    content: "Reconcile public exports, dependency metadata, changesets, generated assets, shared scripts and ledger evidence; verify no lane retained competing implementations or introduced ownership cycles."
    status: completed
  - id: integrated-feature-parity-consumer-matrix
    content: "Build and test packed packages with source unavailable across current create/add/validate workflows, native typed BFF, router/SSR/i18n, Node/workerd federation, release receipts and retained browser scenarios."
    status: completed
  - id: integrated-feature-parity-tractor
    content: "Update and validate /Users/satan/side/experiments/tractor-store-vertical when present, preserving visible UI and proving the changed generator/runtime/tooling behavior downstream."
    status: completed
  - id: integrated-feature-parity-publish-results
    content: "Run required lint/build/test/boundary gates, report production/template/test/vendor deltas and preserved feature evidence, update Beads, commit and push to bleedingdev."
    status: in_progress
isProject: false
---

# integrated-feature-parity

## Execution Notes

Root integration owner. Own cross-lane acceptance evidence, shared lockfile/package-script integration, release changesets, final ledger resolution and downstream acceptance coordination. Publishing results means committing audit/implementation evidence and pushing the fork; it does not authorize an npm release or upstream push. Do not clear unrelated stashes or prune unrelated branches.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.14` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. All implementation and consumer acceptance are complete; final result publication is in progress.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Baseline preservation matrix is the pass criterion. Zero hidden app shims, no disabled safety gates, no arbitrary LOC target and no claims from tests that were not run. Scope relevant package builds/tests first and run required monorepo lint. Use existing real consumer tests rather than mirror-implementation assertions. Measure canonical divergence against eded841256 with fixed scope; allowlist writes only through supported reviewed operation. Completion requires all selected Beads work done and fork push verified. Current supported contract excludes framework upgrade/migration machinery, custom Effect client generation and legacy registry fallback already retired on ba2f373ad9. Do not reintroduce them. Keep development dirty/non-Git workspace builds distinct from deployment requiring promotable identity.

Depends on every implementation lane. This is real integration/acceptance work, not a documentation wrapper.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Acceptance evidence

All twelve implementation lanes completed. Full47-task build, repository Biome, ten strict TypeScript configurations, canonical boundary and actual-PR-base allowlist governance passed. Packed consumers passed with framework sources removed and NODE_PATH cleared: BFF2/2 and workspace3/3. Retained browser4/4 and prerequisite3/3 checks passed.

Tractor source-mode acceptance passed on source5438498b2d with an exact46-package cohort and3sidecars: Node/workerd distributed SSR, JavaScript-disabled HTML and visible shopping. Original configured checkout was absent; proof used the pinned disposable checkout, local registry and local servers. Report and measured cuts: docs/audits/fork-simplification-20260922-implementation.md. No npm publication or upstream push. Final commit/fork push remains the only open execution step.
