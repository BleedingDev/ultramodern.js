---
name: Publish and verify the completed renderer features
overview: Ship the qualified renderer feature cohort from merged fork source and verify the actual public installation before closing its work.
todos:
  - id: modernjs-dnpv3.58.18
    content: Merge, publish and verify the complete renderer feature release
    status: pending
isProject: false
---

# Publish and verify the completed renderer features

## Execution notes

Own the release and final feature issue closure. This is the new feature release after PR249, not a duplicate of modernjs-2uw9v's dependency release. Read live registry/release/run state and the existing dependency-release task before choosing any version or dispatch. Never assume its old next-version counter. The Beads blocker on modernjs-2uw9v and dependency-release graph node must be complete before the final feature release. Earlier feature implementation remains independent of that age/acceptance wait. Preserve the repository-wide live concurrency group publish-bleedingdev and cancel-in-progress:false. Inspect active/queued runs and acquire the explicit publication owner before any prerequisite sidecar dispatch.

Use the single focused feature integration PR opened during cohort, after the reviewed native/sidecar prerequisite PRs. Update its final scope against current fork main-ultramodern before acceptance; do not postpone opening it until after review acceptance. Use the repository's visual PR format and changesets, normal hooks, exact-head canonical checks and full boundary gate. Do not bulk-merge the preservation branch's older divergent commits. Merge only qualified source under the user's authorization; any new source repair after a failed release must land through a follow-up PR and accepted merged source before publication. Optional upstream PRs should contain owning changes and have no review nudges or maintainer tags.

Before each irreversible dispatch, inspect all workflow runs and current npm versions/tags/releases. Verify the chosen merge SHA is contained in fork main-ultramodern. Use the existing publish-bleedingdev.yml OIDC workflow from that merged fork branch, never origin/web-infra-dev or local npm credentials. Required new router sidecars were prepared, bootstrapped if needed, and published by cohort before acceptance. Reuse those accepted versions here; publish no additional unqualified sidecar. Verify authenticated accepted output and wait the unchanged 1440-minute consumer age including all new registry transitives. Persist an unused next valid version and run ID in Beads. Resume existing runs/drafts with exact bytes rather than duplicate publication. Inspect required package inventory in the live workflow; verify every intended package, dist-tag, release record and immutable manifest, not one representative package.

The current release-age-exceptions-2026-08-10.json has an empty entries array. Do not add or widen exceptions for this release. Post-publication checks wait the full1440 minutes for newly published framework packages and new transitives, recording the latest authenticated maturity deadline and resuming later without redispatching publication. Existing exact minimumReleaseAgeExclude entries in pnpm-workspace.yaml remain unchanged and do not exempt new versions. Install the public final version through normal registry/tarball requests and repeat the published generated browser/workerd/Node acceptance checks for the supported features. If published acceptance fails, diagnose owning source and ship a reviewed correction without falsely closing work or deleting published assets. Report the exact release/version, workflow and consumer evidence. Close modernjs-dnpv3.58.11/.11.1/.12 and the new tasks only when their criteria are proven and every relevant child, including modernjs-dnpv3.58.11.3, is closed with evidence. Do not close a parent while a required child remains unfinished. Preserve unrelated parent work and issues. Sync/push only owned Beads records and source. Disable only the completed release's scheduler, unwatch completed PRs, and release/clean operation-owned outputs under the recorded cleanup contract.

## Success criteria

The complete intended cohort is publicly available with correct tags and release record. Public generated consumers prove Worker federation, retained development refresh and localized navigation without compatibility shims or skipped feature tests. Every originally preserved source path has a final disposition. Useful independent follow-ups remain safely committed and tracked. No feature is called complete from source-only tests or a partially published registry cohort.

## Constraints

Use the strict1440-minute pnpm flags and post-install baseline exclusion comparison defined in cohort.plan.md for every install or lockfile update; automatic new exemptions never qualify a consumer.

Read `README.md` in this plan directory before execution. Beads is authoritative; update only the named task and its actual completion evidence. This plan's pending todo means its new completion pass has not started, regardless of historical parent issue status. Preserve snapshot ca61247 and all other sessions' work. Do not add app shims, manual navigation handlers, suppressed checks, generated-output edits or weaker acceptance assertions. New Modern behavior belongs in fork-owned packages; upstream-owned non-shrink changes require reviewed source and the same-PR divergence ledger and boundary gate. Never edit installed dependencies to stand in for authored source.

## Operator guidance

Work only in the assigned named branch and file ownership. Read current checks/reviews once, deduplicate active validation, then build the next consumer. Use normal hooks, focused checks and exact artifacts. A failed real consumer keeps this task open with a concrete next action. Register operation-owned outputs, use the external pnpm store and clone-or-copy, and clean only this operation's authorized resources in finally/signal paths. Do not delete other sessions' dependencies.
