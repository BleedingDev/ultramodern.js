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
| proof-interface-scout | unassigned | Read-only: `packages/toolkit/create/src/ultramodern-workspace.ts`, `scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js`, `packages/solutions/app-tools/src/plugins/deploy/platforms/templates/cloudflare-entry.mjs` | none | ready | Map stable proof interface, adapters, duplicate security/indexing logic, and current report invariants. |
| generator-surface-scout | unassigned | Read-only: public web functions in `packages/toolkit/create/src/ultramodern-workspace.ts` and create integration tests | none | ready | Inventory route metadata projection, public surface contract, asset script generation, content expansion, and validation glue. |
| policy-duplication-scout | unassigned | Read-only: quality gate contract, generated validator assertions, integration expectations, README/template docs | none | ready | List duplicated policy literals and identify the smallest owner for policy data. |
| provider-dx-scout | unassigned | Read-only: route-owned metadata/provider code paths, shared-contracts output, dynamic sitemap smoke test | none | ready | Document current provider interface and discovery constraints for `route.sitemap.mjs`. |
| existing-proof-reuse-scout | unassigned | Read-only: existing Cloudflare proof/validation scripts and tests outside create package | none | ready | Identify reusable helpers or test fixtures that avoid adding new proof code. |
| generated-output-baseline-scout | unassigned | Read-only verification only | none | ready | Produce exact commands and generated-file snapshots needed before write lanes start. |

## Wave 2 — Disjoint Write Lanes

Launch only after Wave 1 has returned and the primary agent has chosen shared interface names. Write scopes must stay disjoint.

| Lane | Agent id | Owner / write scope | Dependency | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| proof-characterization-worker | unassigned | Tests only: `tests/integration/create-ultramodern-workspace/tests/index.test.ts` and, if needed, `scripts/ultramodern-cloudflare-ssr-validation/__tests__/*` | Wave 1 proof scouts | blocked | Add characterization tests for current proof output and assertions. Do not edit implementation. |
| proof-module-worker | unassigned | Implementation: proof helper module and generated `proof-cloudflare-version.mjs` template area only | `proof-characterization-worker` | blocked | Extract proof module and wire public URL adapter. Do not edit generator public surface helpers. |
| generator-characterization-worker | unassigned | Tests only: generated route metadata/public surface assertions in create integration tests | Wave 1 generator scout | blocked | Strengthen output characterization before moving generator code. Do not edit implementation. |
| docs-dx-worker | unassigned | Docs only: `packages/toolkit/create/README.md` and generated workspace README text if selected by primary | Wave 1 generator/provider/policy scouts | blocked | Fix DX wording around colocated route metadata, generated compatibility manifest, proof gates, and provider workflow. |

## Wave 3 — Generator And Policy Refactor

Launch after proof extraction is integrated and generator characterization is in place.

| Lane | Agent id | Owner / write scope | Dependency | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| generator-module-worker | unassigned | Implementation: public web generator module or cohesive section in create package | `proof-module-worker`, `generator-characterization-worker` | blocked | Extract public web generation behind a smaller internal interface. Preserve generated output shape. |
| policy-data-worker | unassigned | Implementation: public web quality gate policy data and validator/test wiring | `generator-module-worker` | blocked | Consolidate duplicated policy values without creating a profile engine. |
| provider-discovery-design-worker | unassigned | Design/tests first: provider discovery contract and compatibility tests | `generator-module-worker` | blocked | Design route-owned provider discovery; no implementation until primary accepts seam. |

## Wave 4 — Provider DX Implementation And Verification

| Lane | Agent id | Owner / write scope | Dependency | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| provider-discovery-worker | unassigned | Implementation: provider discovery and generated contentSources compatibility path | `provider-discovery-design-worker` | blocked | Implement build-safe `route.sitemap.mjs` discovery. |
| graph-verifier | unassigned | Verification only | all write lanes | blocked | Run full targeted gates and inspect generated output drift. |

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
