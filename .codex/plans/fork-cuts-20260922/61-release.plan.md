---
name: release-policy-owners
overview: "Reduce workflow interpreter machinery and duplicated registry/evidence semantics without merging authorization boundaries."
todos:
  - id: release-policy-owners-registry
    content: "Share read-only registry transport, retry classification and exact-byte verification between publication and readiness; keep public provenance and write authorization separate."
    status: completed
  - id: release-policy-owners-evidence
    content: "Export one pure readiness semantic validator and call it independently at receipt creation, consumption and outcome recording with each caller identity/digest bindings."
    status: completed
  - id: release-policy-owners-workflow
    content: "Move inline workflow programs into fixed CLI entrypoints and simplify permission-separated job transitions while preserving recovery and attempt identity."
    status: completed
  - id: release-policy-owners-remove
    content: "Delete security-parser branches and duplicated outcome/registry policy made unnecessary by the simpler workflow, retaining mutation coverage for every invariant."
    status: completed
isProject: false
---

# release-policy-owners

## Execution Notes

Own scripts/ultramodern-publish, scripts/ultramodern-production-readiness registry/evidence contracts, scripts/security release workflow validation and .github/workflows/publish-bleedingdev.yml. Exclude boundary governance and canonical patch/sidecar manifests. No real publish is needed to refactor this lane; release actions remain separately authorized. Root owns shared package scripts and workflow conflicts.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.11` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Implementation and focused verification completed in the release owner lane.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve OIDC job isolation, fork owner/ref restrictions, source/tooling qualification, attempt binding, immutable bundle bytes, dry run, recovery producer identity, 404/429/propagation rules, trusted registry origin, provenance, dist tags, forged/partial summary rejection, no-JS/CSS/locale/MF/visible-UI semantics and draining child processes before cleanup. Run existing schedule/security and publish outcome mutations plus actionlint after applying its skill. No privileged mega-job. Current propagation wait maximum is 855 seconds with registry-verification-schedule coverage. publish-security.test.js was deleted; current protection lives in prepare-bleedingdev-packages, publish-outcome, acceptance-receipt, workflow-validator and job-condition tests. The workflow admits two unenforced manual invariants: inline builtin-only Node imports and matching source/published Tractor pins. Prefer removing duplicated constructs, then retain compact direct checks. Do not bulk-restore the deleted suite.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Implementation evidence

The read-only registry module now owns npm metadata transport, absence/throttle classification, tarball digest comparison and the draining worker pool. Publication still owns authorization, signed provenance and the 855-second propagation schedule. Readiness uses the same dist reader, byte comparison and pool with its explicit registry and environment.

`assertAcceptanceReceipt` was already the complete pure contract used by production, consumption and outcome recording. Outcome recording now relies on that validator instead of interpreting the same binding fields again. Identity and digest verification still run independently at each boundary.

The release workflow now invokes fixed CLI commands. The privileged identity producer reuses `verifyReleaseArtifacts`; its partial manifest parser and the redundant bundle-shape gate are removed. Job permissions, owner/ref guards, recovered producer identity and separate publication attempts are unchanged. Workflow validation rejects inline Node programs and mismatched immutable Tractor pins. The generic shell lexer remains because it also validates receipt commands in other workflows; removing it would weaken those checks.

Validation: 148 publish/readiness/security tests passed with `COPYFILE_DISABLE=1`, the macOS tar setting that prevents AppleDouble entries in an existing Tractor test fixture. Actionlint 1.7.12 reports zero errors. The repository workflow security validator and focused Biome checks pass. New tests cover distinct producer/publication attempts and changed bytes, concurrent draining, 404/429/malformed metadata, inline programs and mismatched Tractor pins. No live publication occurred.

Net authored source/workflow change is -19 lines; five focused tests add 233 lines. Most of the registry module extraction is ownership consolidation, not counted as a code cut. Removed policy copies and interpreters are the material improvement. Final packed/downstream integration belongs to integrated-feature-parity.

Independent review found two missing bindings after the registry extraction. Both are now imported from the read-only owner. A regression calls the public source-preflight and post-publication entrypoints with controlled registry responses, real metadata/byte checks and an immediate failure if an already coherent package enters the propagation wait. Isolated Biome undeclared-variable checks pass for both registry modules; removing the metadata import was confirmed to fail that check. The full 148-test lane passes after the repair.
