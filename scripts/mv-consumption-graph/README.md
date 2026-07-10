# MV consumption-graph — Phase 5 local slice (MV-G10 / G11a / G12a / G4-G6)

Productionized observed-consumption tooling for MicroVertical delivery units,
grown from the W5 read-only spike (`scripts/mv-observed-graph-spike/`,
`docs/research/research_observed_graph_spike_20260710.md`). Self-contained Node
ESM, **zero new dependencies**. Read-only toward the repo; generation writes only
under `$TMPDIR`.

Binding vocabulary: root `CONTEXT.md` ("Vertical Dependency": dependencies are
OBSERVED from real consumption, never manifest-declared; "Isolation Boundary": a
MicroVertical depends on another only through published surfaces, never source
imports), ADR-0019/0020, `packages/toolkit/create/delivery-unit-schema-SPEC.md`
(`SurfaceRef` grammar `unitId#surfaceId[@vN]`).

## Tools

| File | MV gap | Purpose |
|------|--------|---------|
| `extract.mjs` | G10 | Observed-edge extractor over a generated workspace; machine JSON `{edges:[{consumer,provider,surface,grammar,evidence[]}],warnings,...}`. |
| `report.mjs` | G11a | Declared-vs-observed dual report: matched / declared-not-observed / observed-not-declared, with source attribution. |
| `cycles.mjs` | G12a | Unit-level cycle detection over observed edges (reuses `audit.mjs` `findCycles` DFS). |
| `isolation.mjs` | G4/G6 | Source-import isolation analyzer — flags cross-unit relative/source imports, keyed by `deliveryUnitId`. |
| `run-all.mjs` | — | Generates a scratch workspace, runs all four, writes combined JSON + markdown. `--selftest` runs fixture assertions. |
| `selftest.mjs` | — | `node:test` assertions over `fixtures/mini-ws`. |
| `generate-ws.mts` | — | Scratch-workspace generator (run through the repo's bundled `tsx`). |
| `lib/graph.mjs` | — | Reused primitives lifted from `scripts/skills/dependency-audit/scripts/audit.mjs`: `walkSourceFiles`, `resolveRelative`, `findCycles`. |
| `lib/workspace.mjs` | — | Unit index from `topology/ownership.json` + `.modernjs/ultramodern.json`; file→unit attribution; declared-edge builder. |
| `lib/grammars.mjs` | — | Observed-consumption grammar extraction (the layer `audit.mjs` structurally lacks). |

## Observed grammars

- **G1 — package-subpath** (static `import`/`export … from`, side-effect
  `import`, dynamic `import()`, `require`): `'@<scope>/<suffix>/<sub>'`. Surface
  from subpath: `Widget`→`#Widget`, `Route`→`#Route`, `api/client(s)`→`#api`.
  Provider unit resolved via `topology/ownership.json` + contract `packageSuffix`.
- **G2 — MF runtime literal**, three shapes, all resolving the MF **alias**→unit
  via the host's `remotes[]` registration:
  - `createHydratedRemote(Ident, '<alias>/<Expose>')` (spike shape),
  - `import('<alias>/<Expose>')` bare literal — what the **current** generator
    emits (`createRemoteComponent(() => import('catalog/Widget'))`), and
  - `loadRemote('<alias>/<Expose>')` string literal (counted under
    `counts.loadRemoteLiteralHits`).
- **G4 — consume-surface literal**: `consumeSurface({ ref: 'unitId#surfaceId[@vN]' })`
  (`packages/runtime/plugin-runtime/src/module-federation/consume-surface.ts`).
  The `ref` uses the canonical `SurfaceRef` string form
  (`unitId#surfaceId[@vN]`, EBNF in `surface-ref.ts`); the `unitId` is the
  canonical `${scope}/${domain ?? id}` delivery-unit id, resolved back to the
  owning unit.

Self-consumption edges (`X→X`) are dropped (not cross-unit dependencies).

## Documented limitation — dynamic consumption (G12a policy input)

`loadRemote(<non-literal>)` sites are **invisible to static extraction** (spike
§8.1). They are collected into a `warnings` list of kind `dynamic-consumption`
(not an error). This is a policy input for G12a — a future lint rule may force
literal specifiers, or runtime/telemetry capture may fill the gap.

Other known follow-ups (from the spike, not yet handled here): transitive
attribution through re-export barrels; cross-repo alias resolution via signed
attestations / RESOLUTION-0001 discovery records (Phase 5 G12b, out of this
local slice).

## Flags & exit codes

All tools: `<workspaceDir> [--json]`. `cycles`, `isolation` and `run-all`
accept `--enforce`. `report` accepts `--enforce` too, but it is a **no-op**.

**Enforcement semantics (as shipped).** Per CONTEXT.md "Vertical Dependency"
— dependencies are emergent/OBSERVED, never manifest-declared — an
observed-not-declared edge is *legitimate* emergent consumption, not a
violation. So the declared-vs-observed `report` is **purely informational and
NEVER gates** (`report --enforce` still exits `0`). Enforcement gates only on
genuine invalid states:

- **report-only default:** exit `0` regardless of findings.
- **`--enforce`:** exit `1` when —
  - `cycles`: any unit cycle,
  - `isolation`: any cross-unit source import OR package-form deep import into a
    non-published subpath,
  - `run-all`: any cycle, any isolation violation, OR any dynamic-consumption
    warning (`loadRemote(<non-literal>)` — the literal-lint policy: authors must
    use statically-resolvable literal refs / `consumeSurface({ ref })`).
- exit `2`: target is not an ultramodern workspace / generation failed.
- exit `3`: `run-all --selftest` had failing assertions **or a crashed
  subprocess** (a self-test import error fails, never reports success).

Isolation violations and observed edges are keyed by the **canonical**
delivery-unit id `${scope}/${domain ?? id}` (mirroring
`packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts`).

`run-all.mjs` flags: `--out <dir>` (default `$TMPDIR/mv-consumption-graph`),
`--ws <existingWorkspace>` (skip generation), `--json`, `--enforce`,
`--selftest`. Outputs `consumption-graph.json` + `consumption-graph.md` in the
out dir.

## Oracle / generation

The `@modern-js/create` package **build is broken by an unrelated workstream**
(rslib tries to bundle a `.md` SPEC as a module). Following the spike, we bypass
the build by loading the generator TS source directly through the repo's bundled
`tsx` loader (`node_modules/.pnpm/tsx@*/…/tsx/dist/cli.mjs`); `run-all.mjs`
locates it automatically. **Additional drift from the spike:** a local source
checkout now *rejects* an explicit `install` package source
(`write-workspace.ts` guard), so `generate-ws.mts` uses
`packageSource: { strategy: 'workspace' }`.

```
node run-all.mjs                       # generate + run all four, write reports
node run-all.mjs --enforce             # same, non-zero on any finding
node run-all.mjs --selftest            # fixture assertions only
node extract.mjs <ws> --json           # observed edges as JSON
```

## Deferred CI wiring (integrator wires later)

Root `package.json` and `.github/**` are **untouchable in this workstream**
(dirty from other lanes), so no npm script or workflow is added here. A later
integrator should wire, e.g.:

- `package.json` scripts:
  `"mv:graph": "node scripts/mv-consumption-graph/run-all.mjs"`,
  `"mv:graph:enforce": "node scripts/mv-consumption-graph/run-all.mjs --enforce"`,
  `"mv:graph:test": "node scripts/mv-consumption-graph/run-all.mjs --selftest"`.
- CI job: run `--selftest` on every PR; run `--enforce` as a gate once
  cross-repo attestation ingestion (G12b) lands, since single-tree enforcement
  cannot see external consumers yet.
