# Finish the preserved renderer implementation

This is an execution plan for the WIP saved at ca61247ac2c09bc9bd1982556f15ee01b6f0e81b on wip/renderer-federation-navigation-20261017. Baseline renderer packages already shipped in 3.9.3-ultramodern.7. The remaining feature scope is native Worker federation, retained development refresh and expanded localized navigation, plus their required generator/tooling and publication work. The historical renderer-agnostic graph is evidence, not a current completion claim.

Dependency PR https://github.com/ultramodernjs/ultramodern.js/pull/249 merged as e61746843a39ab6de0af397c6f58f7bae72342dd after every exact-head check passed. The merge gate is complete and baseline extraction may begin. Keep its dependency publication in modernjs-2uw9v; do not duplicate it or block independent feature work on its sidecar age wait. Current native accepted source is d5988dd936148d70e788783a8e44cb1c82933ca4. Existing dependency asset publication is complete at https://github.com/BleedingDev/octane/releases/tag/ultramodern-octane-d5988dd93614. That accepted runtime/router lack the unfinished Worker APIs. No baseline renderer or already-merged native action fix should be reimplemented.

The ten implementation plans plus two external gate projections and explicit edges in graph-spec.json define this graph. Beads child issues are the task tracker; plan statuses are execution projections. Implementation todos are pending because this new completion pass has not begun. The external dependency-release projection remains in_progress; the merge gate is completed with verified merge and fork ancestry. Existing feature parents stay open until exact public acceptance. No old plan status is copied as evidence of completion.

The baseline task assigns named branches and exact file ownership. After it finishes, native API work, navigation and supporting tooling may proceed independently. Native snapshot APIs unblock Worker implementation and the native dev-refresh port. Worker and dev-refresh then proceed in separate Modern branches while one Octane owner serializes native source. One integrator serializes overlapping native ownership edits and all manifests/profile/lockfile changes. That coordinator is available during implementation, before the downstream cohort task becomes runnable. Lane-local prerequisite wiring is committed by that owner on each lane branch so source and normal local packs can be exercised; it never claims public release qualification. Navigation unblocks a dedicated router-sidecar prerequisite so its producer and age wait can run while Worker, refresh and tooling finish. The downstream cohort task converges those branches and publishes the accepted merged native output. Integration converges before exact installed acceptance, then one release owner ships and verifies the result. Independent implementation lanes use separate named CoW worktrees; no simultaneous writes to shared files.

Excluded work remains in separate conversations/issues: all Ontos application edits; broad deployment portability; renderer hardcoded admission-policy removal; generator architecture/ESM JSON/Effect investigations; unrelated NFT/Zod/CSP research. A concrete prerequisite discovered during execution must name its owning source, failing consumer and bounded change before adding a dependency. Optional upstream merge timing is never a fork release prerequisite.

Read the referenced source in each plan, run the original failing consumer, implement at its owning layer, then run the next real consumer. Do not spend turns repeating unchanged CI or replacing implementation with bookkeeping. Preserve strict minimumReleaseAge1440. Use CEST in user updates. Never delete pre-existing outputs under the guise of disk optimization.

## Required Solid target

Solid application implementation and release acceptance target Solid 2.0.0-rc.15, including the matching @solidjs/web, @solidjs/signals and compiler. The runtime and web package declare Seroval and seroval-plugins 1.6.7 exactly. Requalify the actual installed application, generated entry, streaming/hydration, navigation and development refresh against this tuple. Historical RC13 results remain historical evidence. Native TanStack Solid 1 baseline tests and the mistakenly produced Solid 1.9.17 fork do not qualify Solid 2 and must not become the application dependency. Track this correction under modernjs-dnpv3.58.19. Preserve useful renderer-neutral router changes; never mechanically upgrade upstream-owned Solid 1 packages to Solid 2 or hide their test failures.

## Reproduce the graph

Run `python3 -S graph.py validate`, `python3 -S graph.py dag --format mermaid`, `python3 -S graph.py frontier --lanes 4 --max-depth 1`, or `python3 -S graph.py summary --format json` from this directory. Add `--read-only` to omit saved-state writes, for example `python3 -S graph.py validate --read-only`. graph.py only calls the installed plan-graph CLI with this exact selection and edge set; it does not implement another parser. The saved graph identity and selection hash are in handoff.json. Re-run in a new checkout to regenerate absolute paths and selection hash. This plan directory is intentionally committed despite the global .codex ignore so the implementation and its execution plan cannot be lost.

## Existing executable checks

Run these in the current implementation worktree after the lane's source and genuine candidate dependencies are built. They are starting checks, not the complete acceptance matrix. Use the actual Node/pnpm toolchain required by the merged baseline. Do not install or run source from the old preservation tree just to satisfy a command.

```sh
# Real source development refresh and production browser proofs, with owned fixtures
/Users/satan/bin/owned-temp-dir --run renderer-mf-dev -- node tests/ultramodern-renderers/octane-federation/dev.mjs
/Users/satan/bin/owned-temp-dir --run renderer-mf-production -- node tests/ultramodern-renderers/octane-federation/proof.mjs
# Contract and authentication tests for the preserved Worker and installed-pack runners
node --test tests/ultramodern-renderers/octane-federation-workers/contract.test.mjs
node --test scripts/ultramodern-renderers/installed-cohort.test.mjs scripts/ultramodern-renderers/native-federation-packed.test.mjs
# Genuine compiled fixture plan is produced from candidate builds, never hand-invented
/Users/satan/bin/owned-temp-dir --run renderer-mf-workers -- node tests/ultramodern-renderers/octane-federation-workers/proof.mjs --plan "$COMPILED_FIXTURE_PLAN"
# Router-core official archive versus reviewed patch runtime/declaration controls
node --test scripts/ultramodern-supply/router-core-mask.test.mjs
# Complete canonical boundary measurement, without narrower scope overrides
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js
```

The source dev proof links workspace dependencies today. Dev-refresh and acceptance must add an authenticated installed-cohort mode using `scripts/ultramodern-renderers/native-federation-packed.mjs` and its process/owner validation. Merely changing a symlink to point at a candidate is not installed-package acceptance. Generated Worker consumer acceptance is a separate missing runner row even if the compiled fixture proof passes. Add that row in Worker, expose one reproducible command, and make it blocking in the final feature CI. New native source changes reuse Octane's `scripts/check-package-packs.mjs`, packed-source compiler and canonical package acceptance; they must not replace that producer with an ad hoc archive builder.

## Review

Fable 5.1, Astra 6 and Opus 5.5 completed independent reviews. Astra revalidated the current 12-plan, 14-edge graph as executable subject to its external gates. Fable and Opus identified necessary corrections; every reported finding is addressed in the saved plan. Their final bounded corrections name the actual required workflow job, separate sidecar publication from navigation closure, and reject installer-created age exemptions. Exact rounds, verdicts and responses are in reviews.json. This records reviews and applied corrections, not completed feature implementation.
