---
name: cc-release
overview: "Publish the verified cuts, adopt the published packages downstream, and measure whether maintenance actually decreased."
todos:
  - id: cc-release-freeze-source
    content: "Pin the pushed Tractor adaptation, produce the final release-version bundle, and requalify its exact bytes before publication."
    status: pending
  - id: cc-release-publish-verified-candidate
    content: "Publish the qualified framework and corrected dependencies through the existing release workflow."
    status: pending
  - id: cc-release-published-adoption
    content: "Install the published versions in OntOS and Tractor, rerun required checks and push the final downstream changes."
    status: pending
  - id: cc-release-cut-audit
    content: "Verify forbidden scaffolding is gone, report honest code and upgrade-cost deltas, and close execution tracking."
    status: pending
isProject: false
---

# cc-release

## Execution Notes

Starts only when both real consumers pass the same immutable candidate. Recheck that publication is authorized by the execution request. Planning itself never authorizes running a release now.

Freeze the release source before producing the promotable bundle. `.github/workflows/publish-bleedingdev.yml` pins `tractor_ref` in both `rehearse-tractor` and `tractor-downstream`; both must name the same pushed, reviewed Tractor adaptation commit before the producer starts. The earlier plan's post-publication-only pin update was too late for source rehearsal. The source candidate used to adapt consumers is rehearsal evidence. Commit both pins, complete required release-branch review/integration, then produce a new bundle at the actual release version from the final permitted release source. Rerun exact-bundle fresh-app, OntOS and Tractor acceptance before publishing it. The rehearsal bundle is never promotable. Prove the existing installer replaces rehearsal dependency requests and lock resolution with the supplied final bundle; do not require another Tractor source pin merely to change an installed version. Reuse consumer owners and existing verification commands; add no new acceptance system. A consumer-only lockfile update afterward does not alter framework tarball identity.

Use the existing release pipeline to publish corrected dependencies in dependency order and one new framework version. Verify npm tarball integrity and source identity, and separately verify the GitHub release record because .12 exposed a final change-record failure hidden by overall workflow status. Publish the final qualified bytes without rebuilding or overwriting an existing version. Recovery must reuse that bundle; any product change invalidates its acceptance and requires a new candidate.

Reinstall actual published packages in each downstream checkout and regenerate lockfiles with its own package manager. Reuse the two consumer owners for parallel published acceptance; they must not run against stale tarballs or source links. Commit/push downstream updates. A later Tractor pin advance records the published adoption for future releases; it cannot be used as evidence for the already produced release. Preserve normal repo review/merge policy; deployment is not silently implied by a dependency change.

Success requires zero production consumer read/write paths for release-cohort.json and ultramodern.json, zero patches consumers must apply to UltraModern itself, zero generated consumer patches required by the supported framework features, and zero pass-through command wrappers for framework-only behavior. No old-format fallback, compatibility API, migration engine, duplicate config registry or hook mutation may replace the deleted machinery. Retain the real runtime manifests, build envelopes, DB migrations and public interoperability required by existing features.

Report first-party production code, behavioral tests, generated application files, docs and vendored third-party source separately. Count deleted metadata bytes, wrappers, consumer patch files and dependency upgrade touch points. Report total diff too. First-party implementation plus generated consumer scaffolding should shrink in aggregate; if it does not, stop and explain the tradeoff for review rather than claiming a code-cut victory. Do not cut real tests or features to hit a numeric target.

## Constraints

Root release/integration owner coordinates consumer writers. Only bleedingdev is authorized as the Modern.js push/publish remote; never origin/web-infra-dev without explicit instruction. This lane owns release workflows, accepted demo ref updates, final documentation and tracking. No arbitrary cleanup of user stashes/branches or unrelated Beads records.

## Operator Guidance

Final join after cc-ontos and cc-tractor. Reuse the current release's verification receipts and CI links rather than adding a report system. Validate all meaningful tests once per final change/candidate and rerun only when code or dependencies change or evidence fails. Stop only after successful pushes, verified publication and downstream acceptance, clean owned worktrees, and an honest final feature/cut report. Leave unrelated preexisting work untouched.
