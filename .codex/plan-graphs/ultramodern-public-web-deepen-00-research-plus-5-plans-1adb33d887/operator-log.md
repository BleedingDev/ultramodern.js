# UltraModern Public Web Deepening Operator Log

## Handoff Bundle

- Graph id: `ultramodern-public-web-deepen-00-research-plus-5-plans-1adb33d887`
- Selection hash: `1adb33d887`
- Plan set hash: `9114233ab9`
- State dir: `.codex/plan-graphs/ultramodern-public-web-deepen-00-research-plus-5-plans-1adb33d887`
- Snapshot: `.codex/plan-graphs/ultramodern-public-web-deepen-00-research-plus-5-plans-1adb33d887/snapshot.json`
- Beads issue: `modernjs-7dj5`
- Repo branch: `main-ultramodern`
- Default push remote: `bleedingdev`
- Agent limits observed: `max_threads=50`, `max_depth=3`

## Plan Selection

- `.codex/plans/ultramodern-public-web-deepen-00-research.plan.md`
- `.codex/plans/ultramodern-public-web-deepen-01-route-path-semantics.plan.md`
- `.codex/plans/ultramodern-public-web-deepen-02-artifact-facade.plan.md`
- `.codex/plans/ultramodern-public-web-deepen-03-policy-decisions.plan.md`
- `.codex/plans/ultramodern-public-web-deepen-04-cloudflare-proof-helper.plan.md`
- `.codex/plans/ultramodern-public-web-deepen-05-generated-output-tests.plan.md`

## Dependency Shape

```text
00-research
  -> 01-route-path-semantics
  -> 02-artifact-facade
  -> 03-policy-decisions
  -> 04-cloudflare-proof-helper

01-route-path-semantics
02-artifact-facade
03-policy-decisions
04-cloudflare-proof-helper
  -> 05-generated-output-tests
```

## Current Frontier

- Ready: `ultramodern-public-web-deepen-00-research`
- Blocked: all implementation lanes until research synthesis chooses the first safe implementation seam.

## Conflict Hotspots

- `packages/toolkit/create/src/ultramodern-workspace.ts` is the primary write hotspot for route head generation, public-surface script generation, public-web policy, and Cloudflare proof helper rendering.
- `tests/integration/create-ultramodern-workspace/tests/index.test.ts` is the primary test hotspot.
- Generated file paths, route metadata exports, public-surface contract keys, Cloudflare proof CLI/env/report shape, assertion names, and private-first defaults are compatibility surfaces.

## Agent Waves

### Wave 1: Read-Only Codebase-Deep-Research Scouts

- `route-path-research-scout`: spawned as Gauss, `019eb385-7ad7-7a01-9eb6-c91472ff25d6`.
- `policy-proof-research-scout`: spawned as Aristotle, `019eb385-977f-7a50-b9a4-789c14362527`.
- `tests-contracts-research-scout`: spawned as Sartre, `019eb385-b50c-74f1-8b04-f86755761a7b`.
- `history-adr-research-scout`: spawned as Poincare, `019eb385-ce8f-74c3-bf81-41274d2ba8e1`.

### Wave 2: Implementation Lanes

To be launched only after Wave 1 synthesis. The primary agent owns edits in `ultramodern-workspace.ts`; subagents may own tests or verification when file scopes do not conflict.

## Research Synthesis

Wave 1 completed read-only.

- Poincare confirmed ADR/history constraints: do not create a broad `webSpec`, profile, certification engine, app shim, route wrapper, runtime patch, or generated suppression. Public web remains a framework/template Module with private-first defaults and build/deploy public artifacts.
- Gauss confirmed the first safe Seam is route path semantics in `packages/toolkit/create/src/ultramodern-workspace.ts`. The weak Locality is duplicated path normalization, language prefixing, dynamic segment detection, param matching/expansion, and route-to-directory conversion across generator code, generated route head, and generated public-surface script.
- Aristotle confirmed policy/proof grouping is valid but should follow route semantics. Preserve generated contracts, Cloudflare proof CLI/env/report/assertion Interfaces, budget fallback values, and noindex/indexable policy strings.
- Sartre confirmed the artifact facade is already narrow. Tests should keep string checks for user-facing/generated Interfaces, but future cleanup should move proof helper body substring checks toward behavior.

First implementation lane:

- Start `ultramodern-public-web-deepen-01-route-path-semantics`.
- Single-writer source hotspot: `packages/toolkit/create/src/ultramodern-workspace.ts`.
- Focused test hotspot: `tests/integration/create-ultramodern-workspace/tests/index.test.ts`.
- Characterize optional route params before refactoring because generated route files map `:id?` to `[id$]`, while public-surface provider discovery currently maps providers to `[id]`.

## Implemented Slices

- Completed `00-research` with four read-only scouts and local baseline inspection.
- Completed `01-route-path-semantics` by centralizing generator-side public route path helpers and aligning generated public-surface provider discovery with route-owned optional-param directories such as `[slug$]`.
- Completed `02-artifact-facade` as verification: `createPublicWebAppArtifacts` remains narrow and no extra regression guard was needed in this slice.
- Completed `03-policy-decisions` by adding private policy projection helpers for quality gates, budget fallbacks, robots decisions, and public-surface content expansion decisions, then routing generated consumers through those helpers.
- Partially completed `04-cloudflare-proof-helper`: responsibilities and characterization are mapped; internal assertion-family grouping remains.

## Validation

- `pnpm exec biome check packages/toolkit/create/src/ultramodern-workspace.ts tests/integration/create-ultramodern-workspace/tests/index.test.ts`
- `pnpm --dir tests exec rstest run integration/create-ultramodern-workspace/tests/index.test.ts`
- `pnpm --filter @modern-js/create test`
- `plan_graph.py validate` for the six selected plans.
- `plan_graph.py frontier` now shows `ultramodern-public-web-deepen-04-cloudflare-proof-helper` as the next ready lane and `ultramodern-public-web-deepen-05-generated-output-tests` blocked behind it.

## Follow-Up Beads

- `modernjs-njwc`: Group UltraModern Cloudflare proof helper assertions.
- `modernjs-h243`: Replace brittle public-web generated-output string mirroring. Depends on `modernjs-njwc`.
