---
name: truthful-test-infrastructure
overview: "Use immutable prerequisite builds, real consumer dependency installs and shared typed browser lifecycle instead of bespoke mutable-dist coordination."
todos:
  - id: truthful-test-infrastructure-prerequisites
    content: "Make selected workspace package builds explicit immutable test prerequisites with cold-checkout support; remove implicit rebuild/freshness and dist reader/writer lock protocols after parallel parity."
    status: pending
  - id: truthful-test-infrastructure-consumers
    content: "Install real generated workspace manifests against packed local packages through supported package-manager mechanisms; remove dependency flattening and all-to-all package links."
    status: pending
  - id: truthful-test-infrastructure-browser
    content: "Give the two remaining portfolio browser suites an explicit Playwright dependency and typed shared lifecycle; preserve existing diagnostics and current scenarios without recreating the deleted cross-browser matrix."
    status: pending
isProject: false
---

# truthful-test-infrastructure

## Execution Notes

Own tests/utils/modernTestUtils.js, generatedWorkspaceDependencies.ts, relevant build/fixture helpers and fork browser suite harnesses. Exclude package business assertions and upstream unchanged tests. Coordinate root runner wiring and package scripts through the integration owner. New test assertion deletions are proposals requiring user selection, not authorized by this infrastructure plan.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.12` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. All implementation is pending.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve parallelism, fixture isolation, failure invalidation, ports, reentrant startup safety and boot-timeout child cleanup. Packed consumer proof must reject undeclared first-party imports and honor per-package dependency versions and allowBuilds policy without a homemade YAML/resolver layer. Retained tests are create-ultramodern-workspace and create-bff-runtime integrations, portfolio navigation/workflow, slow bootstrap/offline, SSR/CSR, asset prefixes and Effect mutation/readback. fixtureBuild, packageDistEntries, create-tailwind and superapp-browser-matrix suites are deleted; do not recreate them as a prerequisite. Two remaining browser suites already share diagnostics; do not claim duplicate collectors remain.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.
