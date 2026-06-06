# modernjs-active-next-work operator log

## Bundle

- Graph id: `modernjs-active-next-work`
- Selection hash: `36298c3f13`
- Snapshot: `.codex/plan-graphs/modernjs-active-next-work/snapshot.json`
- State dir: `.codex/plan-graphs/modernjs-active-next-work`
- Plan selection:
  - `.codex/plans/ultramodern-opinionated-defaults-02-public-surfaces.plan.md`
  - `.codex/plans/ultramodern-active-01-generated-blockers.plan.md`
  - `.codex/plans/ultramodern-active-02-generated-proof.plan.md`
  - `.codex/plans/ultramodern-active-03-tractor-cleanup.plan.md`
- Edges:
  - `ultramodern-opinionated-defaults-02-public-surfaces -> ultramodern-active-01-generated-blockers`
  - `ultramodern-active-01-generated-blockers -> ultramodern-active-02-generated-proof`
  - `ultramodern-active-02-generated-proof -> ultramodern-active-03-tractor-cleanup`

## Limits

- `max_threads=50`
- `max_depth=3`
- First wave intentionally uses many read-only agents and one write-capable agent; downstream blocked plans may be scouted but not edited until their graph edge opens.

## Launch Plan

Goal: finish `modernjs-41je` generated proof first, then clean Tractor demo local patches for `modernjs-u3xw.1`, then close the `modernjs-u3xw` umbrella without app-level shims.

Critical path: completed public-surface generation, completed generated blocker fixes, fresh generated proof, then Tractor cleanup.

Conflict hotspots:

- `packages/toolkit/create/src/ultramodern-workspace.ts`: single write owner only.
- `tests/integration/create-ultramodern-workspace/tests/index.test.ts`: read-only in wave 1; integrate locally after generator design stabilizes.
- Package policy files for `3z51`/`zhaq`/`zum6`: read-only in wave 1 because their plan is blocked by public surfaces.
- Tractor repo: read-only in wave 1.

## Wave 1

| Lane | Agent | Mode | Scope | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| public-output-writer | `019e9a7f-425d-7d71-b7c2-a8a10559c04e` Parfit | write-capable | `packages/toolkit/create/src/ultramodern-workspace.ts` only | completed | Draft integrated locally after trimming optional outputs to private-first defaults: robots always, sitemap/site manifest only for actual public routes, no generated security/llms/API catalog by default. |
| public-output-map | `019e9a7f-632b-7c21-a0ac-1435d987a772` Carver | read-only | public asset generation and materialization paths | completed | Insertion map returned: `workspaceAssetsForApp` is the hook; `rewriteShellAppFiles` must also materialize shell assets; topology-derived output must avoid stale vertical state. |
| public-contract | `019e9a7f-7f58-7023-a252-045a40bd5aff` Darwin | read-only | route metadata/publicRoutes contract | completed | Contract confirmed: `publicRoutes` remains derived; defaults stay private; no JSON-LD/profile; renderer projection may need `publicSurface` and description metadata. |
| public-renderer-spec | `019e9a7f-97dc-7942-8425-c5874ca88c1d` Archimedes | read-only | robots/sitemap/manifest/security/llms/API output semantics | completed | Renderer rules returned: zero public routes emit disallowing `robots.txt`; omit sitemap/manifest/security/llms/API by default; no route leaks, no build-time `lastmod`, deterministic output. |
| public-validation | `019e9a7f-ad8c-7ac1-a179-9bf5ca2f2dcc` Hypatia | read-only | generated validator and integration tests | completed | Test plan returned: require only always-emitted files; assert optional discovery absence/emptiness for private defaults; add route metadata parity and deterministic generation helpers. |
| public-docs | `019e9a7f-c14d-7f20-8f8b-a885f8ef4fcf` Singer | read-only | generated README/create docs/ADR wording | completed | Docs outline returned; update create README, template workspace README, ADR-0016, UltraModern docs, and remove stale contract/path claims after generator semantics settle. |
| blocker-policy-map | `019e9a7f-d9f7-7301-be7e-cf3970284fd2` Hume | read-only | package-source policy duplication | completed | Consolidation map returned: keep create-side package-source metadata as contract, consume `ultramodern.frameworkVersion`, delete duplicated package lists from generated validators/proofs/doctor later. |
| blocker-tsgo-map | `019e9a7f-ee1b-7bf2-9155-fd2763358bd8` Halley | read-only | create package tsgo/effect-tsgo blocker | completed | Map returned: strict typecheck already uses `effect-tsgo`; MF DTS still enforces classic `typescript`. Later `zum6` lane must challenge any compatibility wait and prefer native/effect tsgo per owner direction. |
| blocker-effect-map | `019e9a80-006f-7712-a4a5-aab555a5c9ea` Kepler | read-only | generated Effect dependency ownership | completed | Ownership evidence returned: generated apps should not declare direct `effect`; plugin-bff owns runtime `effect`; later `zhaq` fix should target plugin-bff codegen/package resolution and add negative generated assertions. |
| blocker-mf-smoke-map | `019e9a80-1706-7c61-a59a-f54875ffb126` Erdos | read-only | shell MF browser smoke failure | completed | Repro map returned: shell-only page errors from remoteEntry consume runtime; all vertical standalone checks pass; fresh run must confirm whether `runtimeContext` is still live. |
| generated-proof-map | `019e9a80-2c04-7f92-8db8-afec276fcb1f` Goodall | read-only | generated proof commands/artifacts | completed | Proof matrix returned: keep `41je` open until four blockers close; clear stale artifacts; archive source/browser/cloudflare/published evidence; add separate no-JS SSR proof. |
| tractor-cleanup-map | `019e9a80-41ba-7da2-a0ea-a55ae853c68d` McClintock | read-only | Tractor demo cleanup | completed | Cleanup sequence returned: wait for generated proof; clear stale artifacts; refresh exact cohort; remove shims/CSS/boundary/i18n hacks only when framework proof is green; return failures to Modern.js. |

## Wave 2

Public surfaces are complete and committed in `f90d5527ba`; generated blockers are complete; `ultramodern-active-02-generated-proof` is now ready.

| Lane | Agent | Mode | Scope | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| generated-policy-writer | `019e9a8f-1db5-7a52-b03d-b52606dfc379` Copernicus | write-capable | create package-source policy, generated validators/proofs/doctor only | completed | Integrated shared package-source policy helper; proofs/doctor/generated validators now consume `.modernjs/ultramodern-package-source.json`, and published-create proof uses `ultramodern.frameworkVersion`. |
| create-tsgo-writer | `019e9a8f-4549-7bb2-8c14-4d14d7d59abc` Descartes | write-capable | `packages/toolkit/create/tsconfig.json` and minimal create-package tsgo gate only | completed | Removed `baseUrl` and switched create package `moduleResolution` to `Bundler`; native checker reaches source diagnostics with no TS5102/TS5108. |
| plugin-bff-effect-writer | `019e9a8f-67c1-7c82-aee4-ab4c092d402b` Anscombe | write-capable | `packages/cli/plugin-bff/**` only | completed | Moved OpenTelemetry off the edge export path; added plugin-bff worker consumer regression and generated negative assertions for no direct `effect` dependency. |
| mf-smoke-verifier | `019e9a8f-8441-7f70-aa5f-fc5360efffc7` Rawls | verification-only | smoke artifacts and MF/runtime evidence only | completed | Fresh 10-vertical browser smoke passed with no shell page errors or `runtimeContext`; archived failure is stale and likely fixed by prior per-app Rspack runtime identity work. |

## Gate Notes

Targeted gates passed for the integrated blocker fixes: Biome on edited files, create build, create Tailwind and UltraModern workspace integration suites, proof/doctor/publish unit suites, plugin-bff tests, browser-smoke unit tests, and `git diff --check`.

`modernjs-9kxf` is now closed in commit `7b0b734ca5`; `pnpm validate:tsgo` passed all 12 critical configs, and focused BFF, plugin-tanstack, runtime tests plus focused builds passed. This completes `ultramodern-active-01-generated-blockers`.

## Current Frontier

- `ultramodern-opinionated-defaults-02-public-surfaces`: done.
- `ultramodern-active-01-generated-blockers`: done.
- `ultramodern-active-02-generated-proof`: ready; owns `modernjs-41je`.
- `ultramodern-active-03-tractor-cleanup`: blocked by generated proof; owns `modernjs-u3xw.1` cleanup and then `modernjs-u3xw` umbrella closure.

Keep `modernjs-a6d4` and JSON-LD follow-ups outside this active graph; ADR-0016 and Beads keep resilience/performance and structured-data policy as later work.
