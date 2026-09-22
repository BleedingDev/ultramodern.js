---
name: truthful-test-infrastructure
overview: "Use immutable prerequisite builds, real consumer dependency installs and shared typed browser lifecycle instead of bespoke mutable-dist coordination."
todos:
  - id: truthful-test-infrastructure-prerequisites
    content: "Make selected workspace package builds explicit immutable test prerequisites with cold-checkout support; remove implicit rebuild/freshness and dist reader/writer lock protocols after parallel parity."
    status: completed
  - id: truthful-test-infrastructure-consumers
    content: "Install real generated workspace manifests against packed local packages through supported package-manager mechanisms; remove dependency flattening and all-to-all package links."
    status: completed
  - id: truthful-test-infrastructure-browser
    content: "Give the two remaining portfolio browser suites an explicit Playwright dependency and typed shared lifecycle; preserve existing diagnostics and current scenarios without recreating the deleted cross-browser matrix."
    status: completed
isProject: false
---

# truthful-test-infrastructure

## Execution Notes

Own tests/utils/modernTestUtils.js, generatedWorkspaceDependencies.ts, relevant build/fixture helpers and fork browser suite harnesses. Exclude package business assertions and upstream unchanged tests. Coordinate root runner wiring and package scripts through the integration owner. New test assertion deletions are proposals requiring user selection, not authorized by this infrastructure plan.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.12` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Implementation and focused acceptance are complete. Root owns integrated release and downstream acceptance.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve parallelism, fixture isolation, failure invalidation, ports, reentrant startup safety and boot-timeout child cleanup. Packed consumer proof must reject undeclared first-party imports and honor per-package dependency versions and allowBuilds policy without a homemade YAML/resolver layer. Retained tests are create-ultramodern-workspace and create-bff-runtime integrations, portfolio navigation/workflow, slow bootstrap/offline, SSR/CSR, asset prefixes and Effect mutation/readback. fixtureBuild, packageDistEntries, create-tailwind and superapp-browser-matrix suites are deleted; do not recreate them as a prerequisite. Two remaining browser suites already share diagnostics; do not claim duplicate collectors remain.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Implementation evidence

The test runner now builds before workers start, packs immutable framework artifacts once, and passes a verified package manifest to generated consumers. Workers only assert prerequisite completeness. Removed workspace freshness recursion, implicit package builds, promise caches and dist reader/writer/reentrant locks; the independent port allocator and boot-timeout cleanup remain.

Generated consumer installs now use actual generated manifests, pnpm native workspace resolution and local artifact overrides parsed through the supported @modern-js/utils YAML export. They execute the installed CLI. Removed dependency flattening, custom allowBuilds YAML parsing and all-to-all first-party links.

Both portfolio suites import Playwright directly and share a typed browser/page lifecycle; their existing assertions and diagnostics remain. Root integrates the explicit dependency and runner scripts.

Focused prerequisite behavior checks: 3 passed (parallel builds alongside a live server, startup timeout child cleanup, and parallel nested runners consuming one owner manifest without a package-manager executable). Changed-file Biome checks passed. The packed generated-workspace and browser acceptance results follow below.

The two generated suites now scaffold with a standalone packed generator outside the repository, use the workspace-installed CLI for builds/validation, and have no source-bin fallback. They explicitly select the supported workspace dependency strategy because source tarballs do not carry an authenticated published release cohort. Registry/cohort release qualification remains separate. The sole retained source-bin invocation tests rejection of an explicit install request from a source checkout.

One top-level runner owns prepare/build/pack; nested invocations inherit its artifact manifest and cannot rebuild. Simultaneous independent top-level build writers are outside this contract. The runner uses cross-spawn for Windows command shims.

Packed acceptance first pass installed the real standalone generator and generated dependency graphs successfully. It exposed two owning-layer defects previously hidden by source links: injected workspace TypeScript was externalized from the Effect BFF server bundle, and direct routes-generate resolved Module Federation config from workspace cwd instead of the app directory. The owning framework packages fixed both defects before requalification. Public-surface generation with the standalone installed packed CLI passed after removing the old test-only source-bin invocation. No assertions were deleted or weakened.

After the owning BFF loader bundled injected workspace TypeScript, packed BFF acceptance passed both retained tests (39.4 seconds): installed generator, real generated dependency installation, installed CLI build, production serving and Effect response. Artifact inventory is retained for integrated acceptance; no shared builds occur while consumers run.

Both retained portfolio browser suites passed all four scenarios with the direct Playwright dependency (18.3 seconds): SSR/forced CSR, configured asset prefixes, route navigation/workflow, and slow-bootstrap/offline recovery. Diagnostics and assertions remain.

The source-unavailable fixture now removes framework src directories only inside disposable installed package roots and verifies built entry realpaths. It clears the test host NODE_PATH for consumer children. This exposed a real routes-worker dependency ownership bug: its provider lookup anchored at workspace root instead of the owning app; the owner corrected that anchor before final shell qualification.

Actual packed validator acceptance also passed before route generation: the installed workspace CLI validated with framework src directories absent and NODE_PATH cleared. App-owned TanStack resolution stayed inside the consumer and an undeclared exported first-party subpath failed resolution. A later shell failure exposed the canonical Module Federation ESM patch using bare require. Its owner supplied the native-ESM fix, which the final packed suite exercised successfully.

Final packed workspace acceptance passed all three retained tests in 36.8 seconds. The installed validator, routes-generate command with natural process exit, generated router artifacts, shell production build, mixed-cohort rejection, source-checkout install rejection and public-surface outputs all passed. Framework source copies were absent and NODE_PATH was empty. Package entry realpaths stayed inside the consumer, and an undeclared first-party runtime subpath could not resolve. Packed BFF acceptance also passed both tests under the same source isolation. No retained assertions were removed.

Evidence logs are `/tmp/modernjs-fork-cuts-packed-workspace-qualified.log`, `/tmp/modernjs-fork-cuts-packed-consumers-isolated.log` and `/tmp/modernjs-fork-cuts-portfolio-final.log`. The immutable artifact manifest remains at `/tmp/modernjs-fork-cuts-test-packages-20260922/packages.json` for root integration acceptance.
