# UltraModern Public Web Simplification Subagent Graph

## Handoff Bundle

- Plan selection:
  - `.codex/plans/ultramodern-public-web-simplify-01-cloudflare-proof.plan.md`
  - `.codex/plans/ultramodern-public-web-simplify-02-generator-module.plan.md`
  - `.codex/plans/ultramodern-public-web-simplify-03-policy-data.plan.md`
  - `.codex/plans/ultramodern-public-web-simplify-04-provider-dx.plan.md`
- Plan dependency overlay:
  - `ultramodern-public-web-simplify-01-cloudflare-proof:ultramodern-public-web-simplify-02-generator-module`
  - `ultramodern-public-web-simplify-02-generator-module:ultramodern-public-web-simplify-03-policy-data`
  - `ultramodern-public-web-simplify-02-generator-module:ultramodern-public-web-simplify-04-provider-dx`
- Graph id: `ultramodern-public-web-simplify-01-cloudflare-proof-plus-3-plans-d2e47e5865`
- Selection hash: `d2e47e5865`
- Snapshot path: `.codex/plan-graphs/ultramodern-public-web-simplify-01-cloudflare-proof-plus-3-plans-d2e47e5865/snapshot.json`
- State dir: `.codex/plan-graphs/ultramodern-public-web-simplify-01-cloudflare-proof-plus-3-plans-d2e47e5865`
- Resolved agent limits: `max_threads=50`, `max_depth=3`

## Goal

Refactor the UltraModern public web work so it is easier to maintain and easier to author against, without changing generated public contracts, CLI flags, env variables, route metadata shape, private-first behavior, or proof coverage.

## Parallelism Strategy

The plan files intentionally encode conservative plan-level dependencies. For heavy subagent execution, split the early todos into read-only scouting nodes because those do not require the upstream implementation seams to be complete. Keep write-capable nodes serialized only where they touch the same files or define shared interfaces.

Use up to 8 concurrent subagents in practice despite the higher configured thread limit. Keep the primary agent on integration, shared interfaces, and final verification.

## Wave 1 — Parallel Read-Only Scouts

Launch these together. They must not edit files.

| Lane | Agent id | Owner / write scope | Dependency | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| proof-interface-scout | `019eb31e-e0a2-7de0-b844-a91919e3605a` / Linnaeus | Read-only: `packages/toolkit/create/src/ultramodern-workspace.ts`, `scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js`, `packages/solutions/app-tools/src/plugins/deploy/platforms/templates/cloudflare-entry.mjs` | none | complete | Stable seam: create-owned proof runner with URL/local-Worker adapters; preserve generated CLI flags, env vars, report schema, assertion names, and private-first behavior. |
| generator-surface-scout | `019eb31e-fbbb-7732-81b0-a99b2cdfc322` / Dirac | Read-only: public web functions in `packages/toolkit/create/src/ultramodern-workspace.ts` and create integration tests | none | complete | Recommended seam: internal `createPublicWebAppArtifacts(app)` plus sibling public-surface asset script renderer; preserve generated route metadata, publicHead/publicSurface contracts, CLI, scripts, and managed-source cleanup behavior. |
| policy-duplication-scout | `019eb320-8bf6-78e2-b744-36a28ffd059e` / Goodall | Read-only: quality gate contract, generated validator assertions, integration expectations, README/template docs | none | complete | Duplication spans quality gates, public-surface content expansion, public-head robots, proof fallbacks, validator snippets, tests, and docs; smallest seam is private `PUBLIC_WEBSITE_POLICY` near public-web generator, excluding Cloudflare runtime security ownership. |
| provider-dx-scout | `019eb320-8c9e-79c0-8824-eac3e8624460` / Arendt | Read-only: route-owned metadata/provider code paths, shared-contracts output, dynamic sitemap smoke test | none | complete | Current runtime supports `contentSources` and `route.sitemap.mjs` export forms, but generator discovery returns empty sources; preserve explicit manifest compatibility, loader context, filters, validation, and no page/CSS imports. |
| existing-proof-reuse-scout | `019eb320-8d37-7961-a66e-3f94d82171f9` / Curie | Read-only: existing Cloudflare proof/validation scripts and tests outside create package | none | complete | Reuse adapter mechanics/fixtures from local SSR validator and Cloudflare tests; keep browser smoke separate; generated proof needs stricter assertion library plus CLI/report shell, without importing runtime implementation. |
| generated-output-baseline-scout | `019eb320-8dc9-7b00-a312-d35c33ae7a6a` / McClintock | Read-only verification only | none | complete | Baseline gates: create-ultramodern integration, `@modern-js/create` tests, plan graph validate; invariants cover generated proof CLI/report/assertions, public surface contract/assets, route metadata manifest, quality gates, and private-first outputs. |

## Wave 2 — Disjoint Write Lanes

Launch only after Wave 1 has returned and the primary agent has chosen shared interface names. Write scopes must stay disjoint.

| Lane | Agent id | Owner / write scope | Dependency | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| proof-characterization-worker | `019eb324-61c5-7950-b6aa-149939b593fe` / Lagrange | Tests only: `tests/integration/create-ultramodern-workspace/tests/index.test.ts` and, if needed, `scripts/ultramodern-cloudflare-ssr-validation/__tests__/*` | Wave 1 proof scouts | complete | Added generated proof-script contract coverage for CLI help, report schema, skipped reports, `--app`, `--require-public-urls`, public URL envs, assertion names, budgets, and Cloudflare/security/public-surface references. |
| proof-module-worker | primary / local | Implementation: proof helper module and generated `proof-cloudflare-version.mjs` template area only | `proof-characterization-worker` | complete | Extracted reusable generated proof logic to `scripts/ultramodern-cloudflare-proof.mjs`; `proof-cloudflare-version.mjs` remains the CLI/report adapter and imports `validateApp`. Integration suite passes. |
| generator-characterization-worker | `019eb324-6255-74c2-96db-31962383ec15` / Newton | Tests only: generated route metadata/public surface assertions in create integration tests | Wave 1 generator scout | complete | Added characterization for public surface contract shape, compatibility manifest, colocated root `route.meta.ts`, asset script help, and dynamic contentSources for named/default loader providers across dist/cloudflare targets. |
| docs-dx-worker | `019eb324-62e7-7243-a1d4-2505c7ae1145` / Hypatia | Docs only: `packages/toolkit/create/README.md` and generated workspace README text if selected by primary | Wave 1 generator/provider/policy scouts | complete | Updated README/template wording for colocated route metadata, generated compatibility manifest, build/deploy public artifacts, explicit contentSources provider wiring, and proof gates. |

## Wave 3 — Generator And Policy Refactor

Launch after proof extraction is integrated and generator characterization is in place.

| Lane | Agent id | Owner / write scope | Dependency | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| generator-module-worker | primary / local | Implementation: public web generator module or cohesive section in create package | `proof-module-worker`, `generator-characterization-worker` | complete | Introduced internal `createPublicWebAppArtifacts(app)` facade for route metadata/head files, route meta/alias files, publicHead/publicSurface contract fragments, command rendering, and managed asset policy. Integration suite passes. |
| policy-data-worker | primary / local | Implementation: public web quality gate policy data and validator/test wiring | `generator-module-worker` | complete | Added private `PUBLIC_WEBSITE_POLICY` owner for generated public-web quality gates, public-head robots defaults, public-surface provider/filter defaults, validator checks, and proof fallback rendering. Integration suite passes. |
| provider-discovery-design-worker | primary / local | Design/tests first: provider discovery contract and compatibility tests | `generator-module-worker` | complete | Accepted seam: generated public-surface asset script discovers existing route-owned `route.sitemap.mjs` files for dynamic public routes at generation time, merges them with explicit `contentSources`, and never imports page/CSS modules. |

## Wave 4 — Provider DX Implementation And Verification

| Lane | Agent id | Owner / write scope | Dependency | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| provider-discovery-worker | primary / local | Implementation: provider discovery and generated contentSources compatibility path | `provider-discovery-design-worker` | complete | Generated public-surface asset script now discovers existing dynamic-route `route.sitemap.mjs` providers and merges them with explicit `contentSources`; docs/help updated; integration suite passes. |
| graph-verifier | primary / local | Verification only | all write lanes | complete | Passed create-ultramodern integration suite, `@modern-js/create` tests, Biome on touched source/test files, and plan graph validation. |

## Critical Path

`proof-interface-scout` -> `proof-characterization-worker` -> `proof-module-worker` -> `generator-module-worker` -> `provider-discovery-worker` -> `graph-verifier`.

Policy and docs lanes should run beside the critical path once their read-only prerequisites are satisfied.

## Conflict Hotspots

- `packages/toolkit/create/src/ultramodern-workspace.ts`: single implementation owner at a time. Read-only scouts may inspect concurrently.
- `tests/integration/create-ultramodern-workspace/tests/index.test.ts`: test-only workers must not overlap; sequence characterization additions if both need the same assertion block.
- `packages/toolkit/create/README.md`: docs-only owner must not edit implementation.
- `scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js`: do not edit until the proof module seam is defined.
- Generated contract keys and CLI flags are shared interfaces; primary agent owns final decisions.

## Node Prompt Templates

### Read-Only Scout

```text
Role: explorer
Goal: Investigate <one lane> for the UltraModern public web simplification graph.
Dependencies: none.
Inputs and context: use graph id ultramodern-public-web-simplify-01-cloudflare-proof-plus-3-plans-d2e47e5865 and the matching plan file.
Write scope: none. Stay read-only.
Required output: concrete findings with file paths, stable interfaces, duplication points, and recommended ownership.
Verification: cite commands or searches used.
Notes: Do not solve adjacent problems or propose behavior changes.
```

### Write-Capable Worker

```text
Role: worker
Goal: Implement <one bounded lane>.
Dependencies: <completed scout or worker lane>.
Inputs and context: use graph id ultramodern-public-web-simplify-01-cloudflare-proof-plus-3-plans-d2e47e5865 and the matching plan file.
Write scope: <exact files or module>. You are not alone in the codebase; do not revert edits made by others.
Required output: changed files, exact verification run, residual risk.
Verification: run the narrowest relevant tests first; broaden only if touched files require it.
Notes: Do not change generated public contracts, CLI flags, env vars, report fields, or private-first behavior.
```

## Launch Command Bundle

Use this exact plan selection when reattaching:

```bash
python /Users/satan/side/experiments/skills/plan-graph/scripts/plan_graph.py frontier \
  --lanes 8 \
  --max-depth 2 \
  --plan .codex/plans/ultramodern-public-web-simplify-01-cloudflare-proof.plan.md \
  --plan .codex/plans/ultramodern-public-web-simplify-02-generator-module.plan.md \
  --plan .codex/plans/ultramodern-public-web-simplify-03-policy-data.plan.md \
  --plan .codex/plans/ultramodern-public-web-simplify-04-provider-dx.plan.md \
  --depends ultramodern-public-web-simplify-01-cloudflare-proof:ultramodern-public-web-simplify-02-generator-module \
  --depends ultramodern-public-web-simplify-02-generator-module:ultramodern-public-web-simplify-03-policy-data \
  --depends ultramodern-public-web-simplify-02-generator-module:ultramodern-public-web-simplify-04-provider-dx
```
