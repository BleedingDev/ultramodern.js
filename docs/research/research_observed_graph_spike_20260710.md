# Observed-Graph Extraction Spike (MicroVertical plan W5) — 2026-07-10

Status: **evidence spike, read-only, unwired**. Owner: terra. Feeds Phase 5
(MV-G10, declared-vs-observed cross-repo). Nothing here ships; the two scripts
under `scripts/mv-observed-graph-spike/` are self-contained and not wired into
`package.json` or CI.

Binding vocabulary: root `CONTEXT.md` ("Vertical Dependency": dependencies are
OBSERVED from real consumption, never manifest-declared),
`packages/toolkit/create/delivery-unit-schema-SPEC.md`
(`SurfaceRef` grammar `unitId#surfaceId[@vN]`, §2), ADR-0019/0020.

## 1. Goal

Prove that observed-edge extraction over ONE literal consumption grammar is
feasible against a real generated MicroVertical workspace, and quantify how the
observed graph diverges from the currently-declared `verticalRefs` /
`consumedBy` topology.

## 2. Method

1. **Scratch workspace** generated OUTSIDE the repo via the generator's own
   programmatic API (`generateUltramodernWorkspace` + `addUltramodernVertical`,
   the same entry points `tests/workspace-manifest.test.ts` uses), driven by
   `scripts/mv-observed-graph-spike/generate-ws.mts`. Output:
   `$TMPDIR/mv-spike-ws/workspace`, scope `@mv-spike`, one shell + three
   full-stack verticals (`catalog`, `checkout`, `inventory`).
   - The package build (`pnpm --filter @modern-js/create build`) is currently
     **broken by an unrelated uncommitted workstream** (rslib tries to bundle
     the new `delivery-unit-schema/SPEC.md` as a module — "you may need an
     appropriate loader"). The spike sidesteps it by running the TS source
     directly through the repo's bundled `tsx@4.22.4` loader
     (`node node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs …`); no
     build, no network (the `install` package-source strategy only writes
     manifests).
2. **Extractor** `scripts/mv-observed-graph-spike/extract-edges.mjs` (plain
   node, zero deps) walks the generated source, attributes each file to a
   consumer unit by path (`apps/<id>/**`, `verticals/<id>/**`), extracts literal
   consumption specifiers, and maps every edge to
   `consumer-unit -> provider-unit#surface`.
3. **Diff** the observed set against declared edges read from
   `.modernjs/ultramodern.json` (`moduleFederation.verticalRefs[]` +
   per-app `moduleFederation.exposes[]`, and `api.consumedBy[]`).

## 3. The literal grammars actually emitted

The generator does **not** emit `loadRemote('<remote>/<expose>')` with a literal
argument. What it emits (verbatim from the generated shell):

| # | Grammar | Example (generated) | Carries |
|---|---------|---------------------|---------|
| G1 | package-subpath `import` / `export … from` | `import CatalogWidgetServer from '@mv-spike/catalog/Widget';`  ·  `export { listCatalog, … } from '@mv-spike/catalog/api/client';` | provider unit + surface (`/Widget`→`#Widget`, `/Route`→`#Route`, `/api/client(s)`→`#api`) |
| G2 | MF runtime literal | `createHydratedRemote(CatalogWidgetServer, 'catalog/Widget')` | remote **alias** + expose; alias→unit via shell `remotes[]` registration |
| G3 | bare `loadRemote(literal)` | `loadRemote<RemoteComponentModule>(specifier)` — **arg is a variable** | nothing (0 literal hits) |

G1 is the primary, highest-signal grammar: it recovers every real cross-unit
edge on its own. G2 independently corroborates the `#Widget` edges (the
generated `remotes` map gives `alias catalog → name verticalCatalog → unit
catalog`). **G3 is a dead end in this codebase** — the shell's `loadRemote` call
is fully generic over a runtime `specifier` variable, so a naive
`loadRemote('…')` scanner (the shape a reader might assume from the plan text)
yields zero edges. Any Phase-5 extractor must key off G1/G2, not G3.

## 4. Observed edge table (6 edges, all cross-unit from the shell)

| Consumer | Provider#surface | Grammar(s) | Sites |
|----------|------------------|-----------|-------|
| shell-super-app | catalog#Widget | G1 + G2 | 2 |
| shell-super-app | catalog#api | G1 | 1 |
| shell-super-app | checkout#Widget | G1 + G2 | 2 |
| shell-super-app | checkout#api | G1 | 1 |
| shell-super-app | inventory#Widget | G1 + G2 | 2 |
| shell-super-app | inventory#api | G1 | 1 |

`loadRemoteLiteralHits = 0`.

## 5. Divergence table (observed 6 · declared 12 · matched 6)

| Class | Count | Edges | Why |
|-------|-------|-------|-----|
| **Matched** | 6 | shell→{catalog,checkout,inventory}#{Widget,api} | real consumption |
| **Declared, not observed** | 6 | shell→{…}#Route (×3); {catalog,checkout,inventory}→self#api (×3) | see below |
| **Observed, not declared** | 0 | — | no phantom/undeclared consumption |

Two distinct divergence mechanisms, both meaningful for the MicroVertical thesis:

- **`#Route` over-declaration (unit-level vs surface-level).** `verticalRefs` is
  a *unit* reference; combined with the provider's declared `exposes`
  (`./Route` + `./Widget`) it implies the shell depends on *both* surfaces. The
  observed graph shows the shell imports only `#Widget`. Observed extraction is
  strictly **more precise** than the declared topology — exactly the
  over-declaration the "dependencies are observed, not declared" rule targets.
- **`consumedBy` self-inclusion.** Each vertical's `api.consumedBy` lists the
  provider itself, producing a declared `X→X#api` self-edge that has no
  cross-unit observed counterpart. (The vertical's page does import its own
  `../../api/<stem>-client`, but as a *relative* self-import — outside the
  cross-unit grammar and not a dependency edge in the MV sense.)

Net: the declared topology is a **superset** of real consumption here — no false
"observed-but-not-declared" surprises in a single freshly generated tree, but a
material amount of declared-only noise that a real observed graph would drop.

## 6. Reuse verdict for `scripts/skills/dependency-audit/scripts/audit.mjs`

Reusable **primitives** (mechanics), not the **model**:

- **Reusable as-is:** `findCycles` (WHITE/GRAY/BLACK iterative DFS, dedups cycles
  by sorted key) — directly applicable to global MV cycle detection *once edges
  are unit-keyed*. `walkSourceFiles` (recursive walker; skips
  `node_modules`/`dist`/…; stops at nested `package.json` boundaries) and
  `resolveRelative` (extension/index relative resolution) are reusable utility.
- **Reusable with narrowing:** `extractSpecifiers` supplies G1 (it already
  captures `import`/`export … from`/`require`/dynamic-`import(literal)`), but it
  **does not** capture the MF runtime grammars (G2 `createHydratedRemote`, and it
  would only catch G3 `loadRemote` if the arg were literal — it isn't).

Missing / wrong-abstraction (why audit.mjs is **retired, not extended in place**
for W5):

1. **No unit/surface attribution.** audit buckets non-relative specifiers by
   **npm package name** (its `usage` map) and builds a **file→file** cycle graph
   from relative imports only. Cross-package edges never enter the cycle graph,
   and nothing is ever expressed as `unitId#surface`. The MV observed graph is
   unit→unit#surface; that layer is entirely absent.
2. **No MF specifier grammar** (G2; G3-when-literal).
3. **No surface granularity** — cannot distinguish `#Route` from `#Widget`,
   which is the single most valuable divergence this spike found.
4. **Wrong diff axis.** audit's "phantom" diff is *source-usage vs
   `package.json` declared deps*; W5 needs *observed edges vs
   `verticalRefs`/`consumedBy`*. Different declared source, different question.
5. **Single-tree only** — no cross-repo / attestation ingestion (Phase 5's core).

Verdict: **lift `findCycles` + the walker into the observed-graph tool; retire
the rest of audit.mjs's dependency model.** The spike's `extract-edges.mjs`
reimplements the ~15-line walker and adds the unit/surface/grammar layer audit
structurally lacks (net new code is the mapping, not the traversal).

## 7. Feasibility verdict (Phase 5 / MV-G10)

**FEASIBLE.** A single literal grammar (G1, package-subpath imports) recovers
100% of real cross-unit edges (6/6) with **zero false positives**, corroborated
by G2. The observed graph is surface-precise and already exposes concrete
declared-vs-observed divergences (`#Route` over-declaration, `consumedBy`
self-edges) that a manifest-declared model cannot. The mechanical primitives
(walker, cycle DFS) exist and are reusable.

## 8. Grammar limitations found (hard boundaries for the real extractor)

1. **Dynamic / nonliteral MF loads are invisible.** The shell's `loadRemote` arg
   is a variable; G3-literal yields 0. Real cross-unit runtime edges are only
   recoverable because the generator *also* emits the G1 static import and the
   G2 `createHydratedRemote(Ident, 'alias/Expose')` literal. Any hand-written or
   future dynamic `loadRemote(computedSpecifier)` would be **unobservable** by
   static extraction and needs either a lint rule forcing literal specifiers or
   runtime/telemetry capture.
2. **Alias→unit indirection requires the registration.** G2 emits the MF
   **alias** (`catalog`), not the unit id or MF name; resolving it depends on the
   shell's generated `remotes[]` map. Cross-repo consumers won't have the
   provider's registration in-tree → needs the Phase-5 signed consumption
   attestation / discovery record (RESOLUTION-0001) to resolve aliases.
3. **Re-export hop.** `#api` is observed at the shell's
   `src/api/vertical-clients.ts` re-export of `@scope/<unit>/api/client`; a
   consumer importing the shell's `./api/clients` barrel is one hop removed. The
   extractor keys on the literal provider specifier, so it attributes to the
   true provider unit — but transitive attribution through barrels is a known
   follow-up.
4. **Self-consumption via relative imports** is deliberately out of the
   cross-unit grammar; if MV wants intra-unit surface usage it needs the
   relative-resolution path (present in audit's `resolveRelative`).
5. **Package-suffix ≠ unit-id in general.** Here suffix==id; the extractor maps
   via `packageSuffix` from the contract, which is robust, but a real tool must
   not assume `@scope/<id>` and should always resolve through the topology.

## Artifacts

- `scripts/mv-observed-graph-spike/generate-ws.mts` — scratch-workspace generator
- `scripts/mv-observed-graph-spike/extract-edges.mjs` — observed-edge extractor + diff (`--json` for machine output)
- Generated workspace (ephemeral): `$TMPDIR/mv-spike-ws/workspace`
