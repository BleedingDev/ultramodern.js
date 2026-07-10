# UltraModern.js MicroVertical implementation-plan review — 2026-07-10

This is an adversarial review of the decided MicroVertical model and the 2026-07-09 gap analysis. It is based on the current `main-ultramodern` worktree. The review treats the vocabulary in `CONTEXT.md` and the decisions in ADR-0019/ADR-0020 as binding; it challenges contradictions, hidden costs, implementation assumptions, and sequencing, not the owner's stated product direction.

**Executive verdict:** do not execute the proposed four phases as written. The direction is viable, but the sequence conflates a missing canonical model with an absent delivery-unit primitive, treats three different execution transports as one loader, attempts graph enforcement before defining an observable consumption grammar, and schedules a router rewrite before reproducing a failure. A safe program starts with compatibility characterization and strict schema dispatch, introduces the new schema behind lossless v1 adapters, unifies discovery and identity rather than transport, makes degraded consumption real, and only then turns observed consumption into graph and zoning gates. The evidence for those corrections is detailed below.

## 1. Verification pass

Verdicts use these meanings:

- **VERIFIED** — the gap report's substantive claim matches the current source.
- **PARTIAL** — the problem is real, but the report overstates absence, understates existing behavior, or proposes the wrong boundary.
- **WRONG** — the claim or its framing is materially false and should not drive sequencing.

### 1.1 MV-G1 — first-class Delivery Unit and Surface schema: **PARTIAL**

The first-class *generator schema* gap is real: `WorkspaceApp` remains an app-shaped record with only `shell | vertical`, optional exposes/API/refs, and team-shaped ownership; `WorkspaceApi` has only `stem`, `prefix`, and `consumedBy` (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-68`). It is wrong, however, to imply that no delivery-unit primitive exists. `createDeliveryUnitRecord` already emits `unitId`, `buildMarker`, `sourceRevision`, package/version, kind, and deploy profile (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts:29-43`), backed by a shared `DeliveryUnitRecord`/build-surface contract (`packages/toolkit/utils/src/universal/backend-federation-contract/types.ts:7-43`).

The real defect is narrower and more dangerous: that identity is stamped only when `app.api` exists in compact config (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:203-310`), the validation contract filters to API-bearing verticals (`packages/toolkit/create/src/ultramodern-workspace/workspace-validation-contract.ts:37-56`), and sync reconstructs only API apps (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit-sync.ts:127-150`). MV-G1 must therefore preserve and generalize the existing identity primitive, not replace it wholesale.

### 1.2 MV-G2 — headless/UI-only/full-stack/horizontal generation: **PARTIAL**

The public generation claim is verified. Neither workspace nor add-vertical options expose a shape selector (`packages/toolkit/create/src/ultramodern-workspace/types.ts:120-143`); every default vertical gets `./Route`, `./Widget`, and an API (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:77-108`); and `writeApp` unconditionally enters config, locale/style, federation, route/shell, and API/remote-expose writers (`packages/toolkit/create/src/ultramodern-workspace/write-app.ts:57-88`).

The absolute representability claim is too strong. Because `exposes` and `api` are optional, raw in-memory `WorkspaceApp` values can describe some UI-only or API-bearing variants, although the writer and public API cannot safely generate them (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-54`). A Horizontal Remote is not a MicroVertical mode at all; it is a separate Delivery Unit by definition (`CONTEXT.md:65-66`). Split it from MV-G2.

### 1.3 MV-G10/MV-G12 — real graph and cycle detection: **PARTIAL**

There is no active MicroVertical consumption graph or cross-delivery-unit cycle gate. The wired boundary validator extracts import specifiers but only applies configured banned regexes (`scripts/boundary-guards/validator.js:69-195`), and the profile is domain-neutral (`scripts/boundary-guards/profile.json:3-49`).

The report's broad “no cycle detector” wording misses a reusable but unwired implementation: the maintainer dependency-audit skill resolves relative imports and runs a DFS cycle detector within each package (`scripts/skills/dependency-audit/scripts/audit.mjs:160-268`). It does not understand MF specifiers, generated clients, logical surface references, delivery-unit ownership, or cross-repo edges, so it is not MV-G12 — but it should be extracted or deliberately rejected before writing another DFS.

Also, current `verticalRefs` are not harmless paperwork. They resolve to concrete remotes (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-200`), add package dependencies (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:48-115`), and are asserted by the generated validator (`packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:1042-1083`, `packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:2324-2329`). MV-G11 therefore needs a dual-read migration, not a rename.

### 1.4 MV-G13 — external-publication metadata: **VERIFIED**

No publication zone, external marker, surface major, or baseline compatibility exists on `WorkspaceApp`/`WorkspaceApi` (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-54`) or on the current delivery-unit record (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts:29-43`). The gap is real.

The gap report's private-package evidence is only supporting evidence, not proof: generated app packages are private/fixed-version (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:276-303`), but web MF surfaces are published by URL, so npm `private` cannot determine their publication zone. The canonical surface descriptor and emitted MF/API/RPC contract must carry the marker.

### 1.5 MV-G14 — ADR-0020 diff gate: **VERIFIED**

The release-gate migration check only verifies that files exist and contain configured snippets (`scripts/release-gates/validator/migration.js:99-118`). CI invokes that generic profile runner (`.github/workflows/contract-gates.yml:170-185`), but no current gate classifies a surface by zone, compares old/new MF/API/RPC contracts, or enforces a side-by-side major. This does not satisfy ADR-0020's explicit CI requirement (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:77-82`).

### 1.6 MV-G16 — decide exact pins versus ranges: **WRONG as a decision; PARTIAL as implementation status**

The policy is already binding: the platform baseline is pinned and advanced centrally, while *external compatibility* is expressed as a range (`CONTEXT.md:56-57`). The code violates or muddies that policy: TanStack Router and Tailwind are exact, Effect is a prerelease, and React/React DOM use carets (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:6-18`, `packages/toolkit/create/src/ultramodern-workspace/versions.ts:28-29`). Tailwind is also publicly optional (`packages/toolkit/create/src/ultramodern-workspace/types.ts:120-143`), with a test that locks in Tailwind-disabled workspaces (`packages/toolkit/create/tests/workspace-integration.test.ts:1351-1427`).

MV-G16 is therefore an enforcement and migration item, not an owner decision. It must distinguish exact producer-cohort pins from externally published compatibility ranges and price the existing no-Tailwind API.

### 1.7 MV-G19 — Platform Overlay contract: **VERIFIED**

Current “overlays” are CodeSmith generator hooks: options carry a generator module plus arbitrary config (`packages/toolkit/create/src/ultramodern-workspace/types.ts:195-214`), and the generator executes that module in a child process with generated runtime data (`packages/toolkit/create/src/ultramodern-workspace/overlays.ts:33-108`). That is extensibility, not a declarative contract proving that an overlay only narrows base freedoms. A Platform Overlay vocabulary must exist before generation exposes shape/protocol choices that an overlay is expected to constrain.

### 1.8 MV-G22/MV-G23 — mandatory degraded consumption and backend identity: **VERIFIED**

The runtime owns fallback classification and telemetry primitives, not a consumption API that requires degraded behavior (`packages/runtime/plugin-runtime/src/module-federation/index.ts:14-262`). The shell template does provide a remote-component fallback, but only for that generated path (`packages/toolkit/create/templates/workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx.handlebars:5-77`).

Backend manifest loading makes `fallback` optional (`packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/load.ts:22-70`), and URL/env references require expected identity only unless legacy/path exemptions apply (`packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/reference.ts:18-91`). Worse, the raw identity-unaware loader is publicly re-exported (`packages/cli/plugin-bff/src/runtime/effect/backend-federation.ts:9-20`) and validates Effect shape but not `unitId`/`buildMarker` (`packages/cli/plugin-bff/src/runtime/effect/backend-federation/load.ts:12-66`). Cloudflare's missing service binding currently returns a plain 502 rather than a typed consumption outcome (`packages/solutions/app-tools/src/plugins/deploy/platforms/templates/cloudflare-entry.005-worker-dispatch.mjs:229-265`).

### 1.9 MV-G25 — unified logical surface resolver: **VERIFIED gap; WRONG proposed implementation boundary**

Discovery is duplicated: browser config generates static environment/public/local MF URLs (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:11-91`), Node independently resolves a path/URL/env manifest and derives a remote (`packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/reference.ts:18-95`, `packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/remote.ts:17-73`), and Cloudflare dispatches a service binding (`packages/solutions/app-tools/src/plugins/deploy/platforms/templates/cloudflare-entry.005-worker-dispatch.mjs:229-265`).

Those execution mechanisms cannot and should not share one loader. MV-G25 should unify `SurfaceRef -> ResolvedDeliveryUnit` discovery, identity, compatibility, and provider selection; browser MF, Node MF, HTTP/API, and Cloudflare binding execution remain platform adapters.

### 1.10 MV-G28/MV-G29 — multi-shell and shell identity: **VERIFIED; size understated**

The generator has a module-level singleton shell descriptor and a wrapper that only changes its refs (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:13-45`). Initial workspace creation always emits that one shell (`packages/toolkit/create/src/ultramodern-workspace/write-workspace.ts:185-194`, `packages/toolkit/create/src/ultramodern-workspace/write-workspace.ts:267-275`), add-vertical rewrites only its fixed paths (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/shell-files.ts:60-217`), and root scripts hard-code `./apps/shell-super-app` (`packages/toolkit/create/src/ultramodern-workspace/workspace-script-plan.ts:173-230`). Normalization also reconstructs every shell through `shellApp`, which can discard configured shell identity/defaults (`packages/toolkit/create/src/ultramodern-tooling/config/normalize.ts:159-176`).

This is an **XL**, not L, change. MV-G29 should be absorbed into the canonical Delivery Unit work: shell identity is not conditional on multi-shell support because a Shell is already a Delivery Unit (`CONTEXT.md:40-41`, `CONTEXT.md:62-63`).

### 1.11 MV-G31 — router provider scoping: **PARTIAL / failure hypothesis unverified**

The implementation facts are verified: the registry lives on a versioned `globalThis` symbol (`packages/runtime/plugin-runtime/src/router/runtime/provider.ts:75-107`), duplicate provider names keep the first factory (`packages/runtime/plugin-runtime/src/router/runtime/provider.ts:109-132`), and only one non-default provider name may register (`packages/runtime/plugin-runtime/src/router/runtime/provider.ts:134-149`). Tests intentionally lock in those semantics, including local-default escape behavior and competing-provider rejection (`packages/runtime/plugin-runtime/tests/router/provider.test.ts:135-165`, `packages/runtime/plugin-runtime/tests/router/provider.test.ts:167-253`). TanStack also re-exports the canonical runtime hooks rather than creating a split hook registry (`packages/runtime/plugin-tanstack/src/runtime/hooks.ts:1-16`).

What is not verified is the claimed real failure for two independent TanStack apps in one realm. Do not change provider semantics until a test with two separately evaluated runtime/plugin instances reproduces wrong routing despite the existing `localDefault` path.

### 1.12 MV-G7 — GraphQL cost and current protocol surface: **VERIFIED gap; size understated**

No GraphQL branch or metadata is present in the current generated protocol surface: generated topology is fixed to Effect HttpApi (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:109-135`) and generated contracts use Effect HTTP API concepts (`packages/toolkit/create/src/ultramodern-workspace/api/shared.ts:161-194`). An Effect RPC runtime primitive does exist (`packages/cli/plugin-bff/src/runtime/effect/handler/types.ts:42-116`, `packages/cli/plugin-bff/src/runtime/effect/handler/rpc.ts:9-44`), but there is no corresponding generator branch. “REST + RPC + GraphQL” is not one L item; GraphQL is a separate XL adapter unless constrained by a real adopter.

## 2. Adversarial critique of the model and plan

### 2.1 Internal contradictions and underspecified contracts

1. **“No manifest-declared dependencies” does not forbid generated topology, but current topology is dependency truth.** A discovery catalog may list available surfaces, and a machine-generated attestation may record observed edges, without making authors declare dependencies. Current `verticalRefs`, however, drive resolution, package dependencies, and validation (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-200`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:48-115`, `packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:2324-2329`). The model needs three explicit artifacts: a surface catalog, an observed-edge attestation, and an aggregated graph. Calling all three “topology” will recreate the contradiction with `CONTEXT.md:22-23`.

2. **Full mesh + separate/private repos + local CI cannot prove global closure.** The model permits private separate repositories (`CONTEXT.md:19-20`), defines dependencies from actual consumption (`CONTEXT.md:22-23`), permits any-to-any consumption (`CONTEXT.md:43-44`), and asks same-change CI to update every in-zone consumer (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:40-48`). A checkout cannot see private consumers or their cycles. A Zephyr-neutral registry of signed, machine-generated consumption attestations with freshness rules is required; otherwise “no cycles” and “all consumers updated” are provable only inside one checkout.

3. **Exact baseline pins and external compatibility ranges are different axes.** Exact pins are coherent for a coordinated producer cohort, but separate-repo/external consumers may remain on older cohorts. `CONTEXT.md` requires both centralized pins and external ranges (`CONTEXT.md:56-57`); current code mixes exact, caret, and prerelease constants (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:6-29`). Resolution must validate host singleton-range intersection without allowing a vertical to choose an independent React/router version.

4. **“Break freely” at source level has an availability price at deploy time.** Same-commit N/N correctness does not prove N/N-1 or N-1/N during independent rollout. The model explicitly tolerates runtime skew (`CONTEXT.md:34-35`, `docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:40-51`), while degraded state only prevents a system-wide crash (`CONTEXT.md:28-29`). A per-unit rollback can still move from one incompatible pairing to another; it does not necessarily restore a compatible pair. Critical operations need either explicit permission to degrade or temporary expand/contract compatibility despite the lack of a permanent in-zone compatibility obligation.

5. **ADR-0018 contradicts the newer model and current code.** It says every vertical has browser UI plus strict Effect API and preserves `shell | vertical` (`docs/super-app-rfc-adr/ADR-0018-backend-federation-contract.md:17-20`, `docs/super-app-rfc-adr/ADR-0018-backend-federation-contract.md:45-56`), conflicting with headless MicroVerticals and per-MV protocol choice (`CONTEXT.md:7-8`, `CONTEXT.md:46-48`). It also calls ESM backend containers unproven and shows `commonjs-module` (`docs/super-app-rfc-adr/ADR-0018-backend-federation-contract.md:162-185`), while generation emits `remoteType: 'module'` (`packages/toolkit/create/src/ultramodern-workspace/backend-federation.ts:99-122`). Amend/supersede ADR-0018 before using it as an acceptance oracle.

6. **A headless unit cannot meaningfully “install Tailwind,” yet it can belong to a baseline cohort.** Headless validity and the four-part baseline coexist in the binding model (`CONTEXT.md:7-8`, `CONTEXT.md:56-57`). The schema should distinguish cohort compatibility from dependencies actually provisioned for an applicable surface; otherwise API-only units either carry irrelevant browser packages or appear nonconformant.

### 2.2 Unpriced consequences of the owner decisions

- **Shared DB prefixes provide ownership, not operational isolation.** Prefixes prevent legitimate cross-vertical table ownership (`CONTEXT.md:16-17`), but they do not isolate credentials, migration locks, destructive wildcard SQL, noisy queries, backups/restores, or agent mistakes. The implementation needs per-MV DB roles, prefix-scoped migration journals/locks, cross-prefix SQL linting, and restore drills while retaining one physical database.

- **Agent isolation is undermined by shared mutable generator files.** `add-vertical` sequentially mutates topology, ownership, overlays, compact config, shell files, root scripts, and root tsconfig (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:56-199`). Parallel agents can collide even when vertical source is isolated. Canonical state updates need locking plus staged/atomic writes, or separate operations must produce mergeable patches rather than rewriting the entire shell/workspace.

- **Delivery identity is volatile across processes.** Build markers include a module-load `Date.now()`/UUID seed (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts:12-24`), while sync regenerates build artifacts from reconstructed descriptors (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit-sync.ts:174-198`). A migration can accidentally rotate identity even when source did not change. The policy must say whether migration preserves the existing marker or intentionally emits a new auditable revision.

- **GraphQL carries a new ecosystem, not a metadata enum.** The current generator emits Effect HttpApi contracts (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:109-135`); only RPC runtime primitives are adjacent (`packages/cli/plugin-bff/src/runtime/effect/handler/rpc.ts:9-44`). GraphQL needs schema ownership, code generation, server/runtime integration, auth/context conventions, persisted-query/depth controls, compatibility diffing, clients, degraded errors, and Cloudflare/Node proofs.

- **Near-instant rollback needs an atomic delivery-unit pointer.** ADR-0019 forbids a successful old-UI/new-backend state and requires whole old/new units to remain routable (`docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md:19-32`, `docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md:38-38`). Browser URLs, Node manifests, API endpoints, and Cloudflare bindings cannot be independently repointed and still claim unit rollback.

- **Multiple shells multiply policy intersections.** Current root scripts, add flow, dependencies, and paths assume one shell (`packages/toolkit/create/src/ultramodern-workspace/workspace-script-plan.ts:191-229`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/shell-files.ts:60-217`). Multiple shells also mean different consumed-surface sets and potentially different compatible baseline intersections. This is an XL migration, not a descriptor-array edit.

### 2.3 Risks missed by the gap report

1. **Unknown schema versions are accepted instead of dispatched.** Normalization copies any numeric `schemaVersion`, maps every non-`vertical` kind to `shell`, fills missing fields from legacy defaults, and reconstructs a `WorkspaceApp` (`packages/toolkit/create/src/ultramodern-tooling/config/normalize.ts:17-216`). A future `horizontal-remote` can silently become a shell. Strict version dispatch and fail-before-write behavior must precede schema v2.

2. **Existing-workspace mutation is lossy and non-atomic.** Add-vertical reads three derived JSON files plus compact config (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/preflight.ts:55-72`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/preflight.ts:126-144`), projects old topology back into `WorkspaceApp` while inferring expose paths and Effect API shape (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/topology.ts:82-146`), then writes many files before running CodeSmith overlays (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:56-180`). A failed migration can leave a half-rewritten published workspace.

3. **The public create surface is already substantial.** `@modern-js/create` publishes ESM, CJS, types, `ultramodern-workspace`, and CodeSmith subpaths (`packages/toolkit/create/package.json:22-70`, `packages/toolkit/create/package.json:101-130`). Stable result types expose created apps/paths, assigned ports, MF names, API prefixes, and warnings (`packages/toolkit/create/src/ultramodern-workspace/types.ts:145-193`). Dry-run must match real-run summaries without writes (`packages/toolkit/create/tests/vertical-dry-run.test.ts:77-152`), and CodeSmith must match CLI output and preserve dry-run behavior (`packages/toolkit/create/tests/codesmith-adapter.test.ts:160-233`). Renaming fields or changing defaults is a published API migration, not an internal refactor.

4. **Snapshot blast radius is unusually high.** The generator test pins the full base-workspace and full-stack-vertical file manifests (`packages/toolkit/create/tests/workspace-manifest.test.ts:15-147`), while content tests pin representative rendered bytes and high-risk codegen classes (`packages/toolkit/create/tests/workspace-content.test.ts:12-105`). The integration suite exercises installed BleedingDev package aliases and generated validation (`tests/integration/create-ultramodern-workspace/tests/index.test.ts:13-33`, `tests/integration/create-ultramodern-workspace/tests/index.test.ts:147-421`). Every shape/schema phase needs intentional snapshot review, not bulk acceptance.

5. **TS7/tsgo constrains parser and public-type work.** The create package builds declarations through `tsgo:dts` and ships ESM/CJS (`packages/toolkit/create/package.json:78-99`); tests forbid compiler-API imports in generator runtime, isolate TS6 compatibility API tests, and lock generated module/DTS boundaries (`packages/toolkit/create/tests/tsgo-boundary.test.ts:65-241`). Do not implement graph extraction by importing TypeScript compiler internals into the published generator.

6. **Existing migrations are specialized, not a schema framework.** `migrate-strict-effect` performs a broad but specific artifact rewrite with dry-run support (`packages/toolkit/create/src/ultramodern-tooling/commands/migrate-strict-effect.ts:49-195`), while delivery sync touches only reconstructed API apps (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit-sync.ts:79-215`). Neither provides strict versioned up/down migration, transactional writes, or lossless unknown-field preservation.

7. **Cloudflare and Node are distinct execution surfaces.** ADR-0018 explicitly makes Cloudflare service bindings/snapshots and Node MF runtime separate adapters (`docs/super-app-rfc-adr/ADR-0018-backend-federation-contract.md:115-185`). A shared URL loader would erase that distinction and could reintroduce the defect ADR-0018 was written to prevent.

8. **External-major retirement is unspecified.** ADR-0020 says keep the prior major until known consumers migrate (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:53-66`) but provides neither a consumer registry nor a minimum support window. Without both, deletion is subjective and private consumers can be stranded.

### 2.4 Sequencing and dependency corrections

| Proposed item | Problem | Required correction |
| --- | --- | --- |
| MV-G1 as one L schema change | Existing identity must be preserved; normalization is permissive/lossy and public outputs are published (`packages/toolkit/create/src/ultramodern-tooling/config/normalize.ts:17-216`, `packages/toolkit/create/package.json:22-70`). | Split G1 into canonical descriptors, lossless v1 adapters, transactional migration, and additive public results. Run it as a strangler with legacy write default first. |
| MV-G16 as a decision next to G1 | The decision is already made, but exact pins, prerelease Effect, optional Tailwind, and external ranges are conflated (`CONTEXT.md:56-57`, `packages/toolkit/create/src/ultramodern-workspace/versions.ts:6-29`). | Recast as baseline-cohort enforcement plus compatibility migration. Do not block unrelated descriptor work on re-deciding policy. |
| MV-G25 “shared UI/backend loader” | Browser, Node, and Cloudflare execute differently (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-91`, `packages/solutions/app-tools/src/plugins/deploy/platforms/templates/cloudflare-entry.005-worker-dispatch.mjs:229-265`). | Share logical discovery, identity, provider SPI, and compatibility; retain platform loaders. Move G23 identity enforcement into this phase. |
| MV-G2 before MV-G19 | New shapes/protocols create choices before overlays can narrow them; current overlay is arbitrary generator execution (`packages/toolkit/create/src/ultramodern-workspace/overlays.ts:33-108`). | Define declarative Platform Overlay vocabulary first. Split Horizontal Remote from MicroVertical presets. |
| MV-G10/G12 immediately after G2 | There is no stable, statically observable consumption grammar; current refs are both configuration and execution (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-200`). | Land logical `SurfaceRef` consumption (G8/G25) first, run declared-vs-observed dual analysis, then enforce local and aggregated cycles. |
| MV-G13 then generic MV-G14 | A generic diff cannot classify MF types, REST/OpenAPI, RPC, and GraphQL breakage; ADR-0020 materializes majors differently per kind (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:61-63`). | Put dormant publication fields in G1, then activate them only with per-kind comparators and an external-consumer registry. |
| MV-G28 in phase 4, size L | Shell identity/path/root-script assumptions are pervasive (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:13-45`, `packages/toolkit/create/src/ultramodern-workspace/workspace-script-plan.ts:191-229`). | Treat as XL after canonical descriptors, resolution, and graph semantics stabilize. Merge G29's identity model into G1. |
| MV-G31 in phase 2 | Current tests intentionally support duplicate copies/local defaults; no two-app TanStack failure is demonstrated (`packages/runtime/plugin-runtime/tests/router/provider.test.ts:135-253`). | Add the failing realm-level reproduction first; fix only if it fails. Close G31 as not-a-bug otherwise. |
| MV-G32 as a cleanup project | Gate semantics belong with the feature that creates them; a late cleanup permits unenforced intermediate states (`scripts/release-gates/validator/migration.js:99-118`). | Kill G32 as a standalone phase. Each graph, zoning, degradation, and overlay item must wire its own gate and delete superseded checks in the same change. |

## 3. Bulletproof plan

### 3.1 Delivery rules that apply to every phase

- Use additive public APIs and dual-read/legacy-write rollout until the stated migration window closes. Existing ESM/CJS/type/CodeSmith exports are compatibility surfaces (`packages/toolkit/create/package.json:22-70`, `packages/toolkit/create/package.json:101-130`).
- Every published package change gets a changeset and a coherent BleedingDev cohort. Installed-package acceptance must continue to exercise the alias cohort already used by integration tests (`tests/integration/create-ultramodern-workspace/tests/index.test.ts:13-33`).
- Any generator/runtime/tooling change must pass the downstream Tractor workspace release-acceptance flow before its phase closes; preserve its visible UI.
- No generated-file hand edits or application shims count as a fix. Framework behavior must be fixed in the owning generator/runtime/tooling layer.
- Each semantic gate lands with its feature. MV-G32 is not scheduled separately.
- Snapshot updates require human-readable intent review. The large manifests/content fixtures make “update all snapshots” an unsafe acceptance strategy (`packages/toolkit/create/tests/workspace-manifest.test.ts:15-147`, `packages/toolkit/create/tests/workspace-content.test.ts:12-105`).

### 3.2 Do first: the one-week risk-reduction cut

**Goal:** remove the largest unknowns without flipping the default schema, generation shape, baseline dependency cohort, or router semantics.

**Work:**

1. Amend/supersede ADR-0018 so headless units, protocol choice, Horizontal Remotes, and current Node ESM behavior no longer contradict its acceptance criteria (`docs/super-app-rfc-adr/ADR-0018-backend-federation-contract.md:17-20`, `docs/super-app-rfc-adr/ADR-0018-backend-federation-contract.md:162-185`).
2. Freeze public v1 behavior: ESM/CJS/types imports, CLI, dry-run, CodeSmith parity, generated path manifests, content snapshots, installed BleedingDev aliases, and current volatile build-marker normalization (`packages/toolkit/create/package.json:22-70`, `packages/toolkit/create/tests/vertical-dry-run.test.ts:77-152`, `packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts:12-24`).
3. Add strict schema-version dispatch and tests proving an unknown version fails before any file write; current normalization accepts any numeric version and coerces kinds (`packages/toolkit/create/src/ultramodern-tooling/config/normalize.ts:17-216`).
4. Define, but do not emit by default, canonical `DeliveryUnitDescriptor`, `SurfaceDescriptor`, `SurfaceRef`, and `ResolvedDeliveryUnit` contracts. Specify v1 down-projection and unknown-field preservation.
5. Build a read-only observed-graph spike over one literal consumption grammar; compare it to current `verticalRefs` without enforcing or deleting anything (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-200`).
6. Add the two-independent-TanStack-app/same-realm reproduction. Make no provider change unless it fails under the current local-default logic (`packages/runtime/plugin-runtime/tests/router/provider.test.ts:167-253`).
7. Specify one discovery record that can resolve to a browser MF manifest, Node backend manifest, HTTP/API address, or Cloudflare service binding while retaining one delivery identity (`docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md:19-32`).

**One-week exit criteria:** current supported v1 inputs produce the same legacy serialization and file set, except for an explicit test-normalized volatile build marker; unknown schema versions leave byte-for-byte unchanged workspaces; public import/dry-run/CodeSmith tests pass; the graph spike reports observed edges without gating; the router hypothesis has a reproducible pass/fail result; ADR-0018 and the resolver contract no longer disagree with binding vocabulary.

**CI:** `@modern-js/create` build/test (including `workspace-manifest`, `workspace-content`, `vertical-dry-run`, `codesmith-adapter`, `tsgo-boundary`), the create integration suite, and any touched runtime router tests. Run Tractor acceptance if even the internal adapter changes generated output.

**Rollback:** all new behavior is validation/test-only or opt-in. Revert the schema guard/contract commit; no v2 document or new runtime pointer has been published.

**Relative size:** **M** (one focused week, two engineers/agents in parallel only after shared contracts are agreed).

### Phase 0 — contract repair and characterization

**Goal:** turn implicit compatibility assumptions into executable guardrails before changing the data model.

**Work items:**

- Formalize the one-week outputs as **MV-G0a** (ADR-0018 repair), **MV-G0b** (strict schema dispatch), **MV-G0c** (public/output characterization), and **MV-G31-R** (router reproduction).
- Reclassify **MV-G16-R**: exact producer pins are binding; external ranges are separate. Record the migration implications of caret React, prerelease Effect, and no-Tailwind v1 (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:6-29`, `packages/toolkit/create/tests/workspace-integration.test.ts:1351-1427`).
- Add a cross-process delivery-identity characterization so later migrations cannot silently restamp unchanged units (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts:12-24`).

**Exit criteria / CI proof:** unknown schema versions fail before the first write; all supported v1 fixtures parse; v1 parse/down-project is lossless for known and unknown fields; public ESM/CJS/types and CodeSmith entry points load; dry-run and actual-run summaries remain equal; supported v1 generation has no output delta.

**Test strategy:** keep `packages/toolkit/create/tests/{vertical-dry-run,codesmith-adapter,workspace-manifest,workspace-content,workspace-determinism,tsgo-boundary}.test.ts` green; add subprocess tests for cross-process identity and fail-before-write; keep `tests/integration/create-ultramodern-workspace` green; run `packages/runtime/plugin-runtime/tests/router/provider.test.ts` plus the new realm reproduction.

**Migration/compatibility:** no default schema or baseline-cohort change. Preserve `enableTailwind:false` on the legacy v1 path; Phase 1 prices its deprecation rather than silently adding Tailwind.

**Rollback:** revert validation/default changes and publish a corrected patch cohort if already released. Because no v2 default exists, old workspaces continue on the v1 parser/writer.

**Relative size:** **M**.

### Phase 1 — compatibility-first canonical Delivery Unit and Surface schema

**Goal:** make Delivery Unit and Surface the internal source of truth without a big-bang rewrite of published workspaces.

**Work items:**

- Split **MV-G1** into:
  - **MV-G1a:** canonical `DeliveryUnitDescriptor`, discriminated `SurfaceDescriptor` kinds, platform locations, identity, source revision, and baseline cohort.
  - **MV-G1b:** lossless v1 parser/down-projector with byte-stable legacy serialization for nonvolatile fields.
  - **MV-G1c:** transactional, idempotent, dry-run-capable, reversible v1→v2 migration with backup/restore and fail-before-write validation.
  - **MV-G1d:** additive public generation descriptors/results; keep every existing result field (`packages/toolkit/create/src/ultramodern-workspace/types.ts:145-193`).
- Absorb **MV-G29**: stamp identity for Shell, UI-only, headless/API-only, full-stack, and Horizontal Remote delivery units instead of filtering on `app.api` (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:276-310`).
- Implement **MV-G3** as attribution (`owner.kind`, `owner.id`, contacts), but keep boundary identity keyed to `deliveryUnitId`; one owner may own many units (`CONTEXT.md:10-11`).
- Add dormant **MV-G13a** fields (`publicationZone`, surface major, compatibility) with default `coordinated`; do not activate external publication yet.
- Add **MV-G19a/MV-G20** declarative overlay-policy vocabulary and classify central constants as baseline, template default, or overlay-owned. Do not confuse this with CodeSmith execution (`packages/toolkit/create/src/ultramodern-workspace/overlays.ts:33-108`).
- Implement **MV-G16/MV-G17a** exact stable cohort generation plus advisory baseline-drift reporting; plan a separate legacy no-Tailwind migration.

**Exit criteria / CI proof:** every current fixture round-trips v1→canonical→v1; unknown versions fail; migration dry-run predicts exactly the real write set; an injected failure restores the original workspace; a second migration is a no-op; all delivery-unit kinds carry identity; legacy public input/default output is unchanged except reviewed baseline-pin deltas; v2 remains opt-in until downstream acceptance passes.

**Test strategy:** keep the entire `@modern-js/create` suite and create integration suite green; add schema property/round-trip, unknown-field, corrupt-input, transaction-failure, idempotency, and shell/UI-only/headless identity fixtures; build ESM/CJS/types through `tsgo:dts` and retain compiler-API prohibitions (`packages/toolkit/create/tests/tsgo-boundary.test.ts:65-241`). Run local and installed BleedingDev cohorts plus Tractor acceptance.

**Migration/compatibility:** dual-read v1/v2; legacy-write by default for at least the owner-approved window. Never rewrite v1 merely because it was read. Preserve existing build markers during schema-only migration; rotate only on a declared new build. Publish additive types first, then opt-in v2 emission, then migration CLI. Keep old field names in down-projection and CodeSmith runtime config.

**Rollback:** disable v2 emission, retain the canonical-to-v1 adapter, and restore the migration backup. If a v2 package has shipped, publish a patch that defaults back to legacy write; do not delete the v2 reader.

**Relative size:** **XL**.

### Phase 2 — shared discovery and delivery identity, platform-specific execution

**Goal:** resolve logical surfaces consistently without pretending browser, Node, HTTP, and Cloudflare use one loader.

**Work items:**

- Split **MV-G25** into:
  - **MV-G25a:** typed, literal `SurfaceRef` naming grammar.
  - **MV-G25b:** provider SPI returning an atomic `ResolvedDeliveryUnit` record.
  - **MV-G25c:** identity, baseline, surface-major, expiry/freshness, and compatibility validation.
  - **MV-G25d:** browser MF, Node MF, HTTP/API, and Cloudflare binding execution adapters.
- Move **MV-G23** here: make expected `unitId` + `buildMarker` mandatory in every public backend load; deprecate the raw loader or make it internal after an additive compatibility window (`packages/cli/plugin-bff/src/runtime/effect/backend-federation.ts:9-20`).
- Implement only an env/local provider initially, adapting current UI URL fallback and backend manifest reference behavior (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-58`, `packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/reference.ts:18-91`).
- Apply **MV-G31** only if Phase 0's reproduction fails. Scope registry state to the actual app/runtime boundary while preserving mixed-published-copy safety; otherwise close it.

**Exit criteria / CI proof:** the same logical ref resolves to one unit identity and a platform-appropriate location; no adapter can successfully combine locations from different identities; expired, missing, incompatible, or mismatched records fail as typed discovery errors; legacy env variables still resolve through an adapter; no Cloudflare URL fiction is introduced.

**Test strategy:** keep `module-federation-remote-refs`, backend federation manifest/runtime, runtime router, and app-tools Cloudflare deploy tests green. Add provider contract tests shared across env/local fixtures, identity mismatch matrices, Node manifest tests, browser manifest tests, and Cloudflare binding selection tests. Run create integration and Tractor because generated config changes.

**Migration/compatibility:** retain current remote-ref/env and manifest APIs as wrappers over the new provider; add deprecation warnings only after parity. Published callers of the raw backend loader get an additive identity-aware overload before the unguarded form is removed in a major release.

**Rollback:** switch the provider feature flag to the legacy env/manifest adapter. Keep new record readers so artifacts already emitted remain readable; never roll back by accepting a known identity mismatch.

**Relative size:** **L**.

### Phase 3 — mandatory degraded consumption and whole-unit rollback

**Goal:** make absence/incompatibility a required, typed behavior at every consumption point and prove atomic per-unit rollback with and without Zephyr.

**Work items:**

- Split **MV-G22** into consumption contracts for web MF components, REST/HTTP, RPC, GraphQL (when present), Node MF, and Cloudflare service bindings. Each requires a degraded handler and telemetry context; current telemetry helpers are reused (`packages/runtime/plugin-runtime/src/module-federation/index.ts:14-262`).
- Implement **MV-G24a** env/static/local providers and **MV-G24b** last-known-good storage/freshness/rollback semantics against the Phase 2 provider SPI.
- Implement **MV-G26a** as an optional Zephyr adapter that passes the same provider conformance suite. Keep all core types and fallback logic Zephyr-neutral.
- Add N/N, N/N-1, N-1/N, missing, stale, incompatible, timeout, and pointer-rollback matrices. Rollback selects one prior `ResolvedDeliveryUnit`, never independent surface addresses (`docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md:25-32`).
- Replace Cloudflare's plain missing-binding 502 with the framework's typed degraded/telemetry path while retaining a correct HTTP failure response (`packages/solutions/app-tools/src/plugins/deploy/platforms/templates/cloudflare-entry.005-worker-dispatch.mjs:247-259`).

**Exit criteria / CI proof:** a consumption call cannot compile/configure without degraded behavior; one unavailable unit does not take down shell/siblings; identity/compatibility failures are observable and typed; env-only operation passes with no Zephyr dependency; mocked Zephyr and LKG providers pass the same suite; rollback changes all locations atomically and never accepts mixed surfaces.

**Test strategy:** keep plugin-runtime MF, plugin-bff backend manifest/runtime, app-tools Cloudflare, and create integration suites green. Add compile-fail/API-shape tests for mandatory handlers, telemetry assertions, process/browser integration for sibling isolation, provider conformance, skew, stale-cache, and rollback tests. Keep live Zephyr proof credential-gated, not required for local CI.

**Migration/compatibility:** introduce required consumption APIs additively; wrap legacy loaders with a default diagnostic-only adapter for one cohort, then make the generated code and CI gate mandatory. Existing generated shell fallbacks map into the new API rather than being duplicated (`packages/toolkit/create/templates/workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx.handlebars:8-77`).

**Rollback:** keep the API but temporarily demote the enforcement gate from blocking to warning for the affected cohort; use the env provider as the guaranteed fallback. Do not restore the public identity-unaware backend path.

**Relative size:** **XL**.

### Phase 4 — generation presets and protocol adapters

**Goal:** generate valid delivery-unit shapes without changing the legacy full-stack default and without making protocol choice a pile of conditionals.

**Work items:**

- Split **MV-G2** into **MV-G2a** MicroVertical presets (`api-only`/headless, `ui-only`, `full-stack`) and **MV-G2H** a separate Horizontal Remote operation. Headless means no user-facing surface, not necessarily one specific API protocol (`CONTEXT.md:7-8`, `CONTEXT.md:65-66`).
- Split **MV-G7** into **MV-G7a** protocol SPI/metadata, **MV-G7b** current Effect HttpApi/REST adapter, **MV-G7c** Effect RPC generator adapter, and **MV-G7d** GraphQL adapter (deferred until its trigger in “Not now”). Effect may remain the runtime baseline while REST/RPC/GraphQL are surface protocols.
- Apply the Phase 1 Platform Overlay policy to allowed presets/protocols; an overlay may narrow but never relax the baseline (`CONTEXT.md:59-60`).
- Preserve all legacy public result fields and full-stack CLI/CodeSmith defaults (`packages/toolkit/create/src/ultramodern-workspace/types.ts:145-214`).

**Exit criteria / CI proof:** API-only emits no UI routes/components/MF exposes; UI-only emits no BFF/API/backend artifacts; full-stack legacy invocation remains output-compatible; Horizontal Remote has its own delivery identity and is never normalized as a shell/MicroVertical; REST and RPC generate/load/degrade on Node and Cloudflare as applicable; overlay rejection occurs before writes.

**Test strategy:** keep all current generator snapshots, dry-run/CodeSmith parity, installed create integration, backend federation, Cloudflare, and tsgo tests green. Add one manifest/content/validator fixture per preset and protocol; negative tests prove forbidden files are absent, not merely unused. Add dry-run parity for every new mode and Tractor acceptance for each shipped preset.

**Migration/compatibility:** new flags and result fields are additive; omitted mode remains the old full-stack behavior. v1 workspaces retain legacy write until migrated. Do not remove `enableTailwind` yet; reject or migrate legacy non-baseline v2 adoption explicitly rather than silently changing old workspaces.

**Rollback:** hide/disable the new mode or protocol flag while leaving its schema reader intact. Existing generated units remain valid through canonical descriptors and platform adapters; the legacy full-stack path is unchanged.

**Relative size:** **XL** without GraphQL; **XXL** with GraphQL.

### Phase 5 — observable full-mesh consumption, real graph, isolation, and separate repos

**Goal:** derive dependency and cycle truth from actual consumption across delivery units and repositories, while keeping resolution metadata non-authoritative.

**Work items:**

- Implement **MV-G8** as the typed surface-consumption operation/API for any consumer (MicroVertical, Shell, Horizontal Remote, external app), using the literal `SurfaceRef` grammar from Phase 2.
- Implement **MV-G10** extractors for that grammar, MF loads, generated API/RPC clients, and forbidden source imports. Reuse or explicitly retire the existing relative-import DFS (`scripts/skills/dependency-audit/scripts/audit.mjs:176-268`).
- Implement **MV-G11a** dual reporting of declared refs versus observed edges; remove `verticalRefs`/`consumedBy` as dependency truth only after parity. Keep a generated surface catalog if resolution needs it.
- Split **MV-G12** into **MV-G12a** local graph/cycle enforcement and **MV-G12b** signed cross-repo attestations plus global closure/freshness enforcement.
- Merge **MV-G4/MV-G6** into one delivery-unit isolation analyzer. Map source paths to `deliveryUnitId`, not owner ID, because one owner may own several MVs (`CONTEXT.md:10-11`, `CONTEXT.md:19-20`). Retain existing regex guards for framework anti-patterns.
- Implement **MV-G5** separate-repo publish/consume commands over surface catalogs/attestations; they must not mutate a local singleton shell.
- Implement **MV-G9** full-mesh acceptance across shell→MV, MV→MV, external app→MV, and separate temporary repos.

**Exit criteria / CI proof:** authored manifests contain no dependency edges; observed edges are reproducible from checked-in consumption; forbidden source imports fail; local cycles fail with actionable paths; global aggregation rejects cycles/stale/missing attestations according to policy; one owner owning A and B does not permit A to import B source; generated refs can be removed without changing runtime resolution.

**Test strategy:** keep boundary-guards, generator, create integration, runtime loaders, and release gates green. Add fixtures for each edge grammar, dynamic/nonliteral rejection, false-positive cases, source-import violations, three cycle kinds, same-owner cross-MV violations, separate-repo publishing, signed/tampered/stale attestations, and registry outage behavior.

**Migration/compatibility:** run graph extraction in report-only mode for one cohort, then fail only new divergences, then enforce all edges. Preserve `verticalRefs` as deprecated resolution hints during dual-run; never reinterpret old authored refs as proof of consumption. Separate-repo metadata versions independently and remains readable by the prior cohort.

**Rollback:** demote graph enforcement to advisory while retaining attestation generation and telemetry. Restore deprecated resolution hints if necessary, but do not restore author-declared edges as cycle truth.

**Relative size:** **XXL**; cross-repo registry work is the critical external dependency.

### Phase 6 — activate zoned versioning and foreign-runtime publication

**Goal:** make external stability an explicit, enforceable cost without imposing permanent compatibility shims inside the coordinated zone.

**Work items:**

- Activate **MV-G13b** external publication and require owner, surface kind, major, baseline compatibility, and retirement metadata.
- Split **MV-G14** into contract-kind comparators: **G14-MF** (expose/type contract), **G14-REST** (OpenAPI/route), **G14-RPC**, and **G14-GraphQL** when GraphQL exists; add side-by-side-major and previous-major-presence checks.
- Merge **MV-G15/MV-G18** into baseline-compatibility emission plus resolver/CI validation against centralized exact pins and host singleton intersections.
- Implement **MV-G27** foreign MF acceptance using canonical `mf-manifest.json` and `remoteEntry.js`, not an UltraModern-only consumer (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:61-66`).
- Feed observed cross-repo consumers from Phase 5 into breaking-change and retirement decisions.

**Exit criteria / CI proof:** unmarked surfaces default internal; marking external is deliberate and fails without complete metadata; internal breaking fixtures pass only with all observed in-repo consumers green; external breaking fixtures fail unless a new major is added beside the old; old-major artifacts remain resolvable; incompatible baseline ranges fail before execution; a foreign MF host loads both canonical entries.

**Test strategy:** keep release gates, generator, resolver/provider, graph, plugin-bff, runtime MF, and integration suites green. Add golden old/new contracts for additive/breaking changes per implemented protocol, unknown-consumer/registry freshness cases, baseline-range intersection, old/new major coexistence, foreign host load, and rollback-to-old-major tests.

**Migration/compatibility:** `publicationZone` defaults to coordinated, so existing surfaces do not accidentally acquire promises. External marking is one-way operationally: once a major is published, retain it until the owner-approved retirement rule is met. Publish schema/readers before allowing writers to mark external.

**Rollback:** disable new external marking if the gate is faulty, but never remove an already promised old major. Repoint to the last compatible whole delivery unit and ship a corrected gate/package cohort.

**Relative size:** **XL** for existing MF/REST/RPC kinds; GraphQL comparator follows G7d.

### Phase 7 — multi-shell composition, enforceable overlays, and thin-shell boundaries

**Goal:** remove the singleton-shell assumption and finish policy enforcement after canonical identity, resolution, and graph semantics are stable.

**Work items:**

- Split **MV-G28** into descriptor/topology support, shell create/remove operations, root-script iteration over configured shells, and add-consumption targeting. Preserve `shell-super-app` as the legacy default ID/path (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:13-45`).
- Implement **MV-G30a** structural shell rules: forbid owning domain API/server/data modules and direct cross-unit source imports; allow routing, baseline provisioning, and typed consumption. Keep **MV-G30b** semantic “business logic” detection advisory until it has low-noise evidence, because intent is not syntactically decidable (`CONTEXT.md:62-63`).
- Activate **MV-G21** overlay non-relaxation validation against baseline and generation choices.
- Complete only the local cleanup portions of **MV-G32** in the owning changes: remove superseded singleton/ref/snippet checks when their semantic replacements are blocking.

**Exit criteria / CI proof:** two shells with overlapping/different consumed sets generate, build, validate, deploy, and roll back independently; both have delivery identities; no root command hard-codes one shell; add-consumption targets a selected consumer; structural shell violations fail; valid routing/composition passes; overlays can narrow protocols/presets but cannot change exact baseline pins.

**Test strategy:** keep generator snapshots/public results, create integration, resolver, graph, degradation, release-gate, and Tractor suites green. Add two-shell manifests/content, add/remove/idempotency/dry-run, per-shell baseline-intersection, shell rollback, structural lint positive/negative, and overlay narrowing/relaxation tests.

**Migration/compatibility:** v1 singleton workspaces map to one canonical shell retaining their exact ID/path. New shell operations are additive. Root scripts enumerate configured shells but must preserve the legacy command output for one-shell workspaces where practical.

**Rollback:** disable multi-shell mutation commands and continue reading multiple-shell descriptors; one-shell legacy workspaces remain unchanged. Demote only noisy semantic shell checks, not structural cross-boundary violations.

**Relative size:** **XL**.

### 3.3 Explicit “not now” list

- **GraphQL implementation (MV-G7d/G14-GraphQL):** define the protocol SPI now; revive the adapter when a real adopter supplies schema/client/runtime requirements or the owner requires it for first GA. Current generation is HttpApi-only and has no GraphQL implementation (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:109-135`).
- **Live Zephyr switching:** implement the provider interface and mocked conformance after env/LKG works; revive live proof when credentials, public URLs, and deployment metadata are available. ADR-0018 already calls live switching credential/public-URL gated (`docs/super-app-rfc-adr/ADR-0018-backend-federation-contract.md:150-160`).
- **Multi-shell implementation:** do not start in the first risk-reduction slice; revive after Phase 1 canonical descriptors and Phase 2 resolution are stable. Current singleton assumptions span descriptors, writer, mutator, normalization, and root scripts (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:13-45`, `packages/toolkit/create/src/ultramodern-workspace/workspace-script-plan.ts:191-229`).
- **Blocking semantic “business logic in shell” lint:** structural rules ship; revive semantic enforcement only after advisory telemetry demonstrates an acceptably low false-positive rate. The invariant is binding, but syntax alone cannot prove domain intent (`CONTEXT.md:62-63`).
- **Date-based versioning:** revive only if a surface becomes a public product with many unknown consumers, exactly as ADR-0020 states (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:68-69`).
- **Deletion of v1 fields/adapters and legacy no-Tailwind behavior:** revive after at least one published reader/migrator cohort, two cohorts capable of down-projection, owner-approved adoption telemetry, and Tractor acceptance. Existing public options/tests make immediate deletion breaking (`packages/toolkit/create/src/ultramodern-workspace/types.ts:120-143`, `packages/toolkit/create/tests/workspace-integration.test.ts:1351-1427`).
- **Choosing Effect versus XState for state management:** no work until a concrete MV use case requires the owner to close the deliberately open choice; neither graph, delivery identity, nor surface resolution depends on it.

## 4. Open questions for the owner

1. **Must every separate/private repository publish signed consumption attestations to a Zephyr-neutral central registry?** **Recommendation: yes.** Without it, global cycles and external-consumer closure are unprovable from local CI under the accepted separate-repo/full-mesh model (`CONTEXT.md:19-23`, `CONTEXT.md:43-44`).

2. **What retires an old externally published major?** **Recommendation:** all registered consumers report migration, the attestation freshness window is satisfied, and a minimum support window expires; unknown consumers require an explicit owner exception. “Until known consumers migrate” alone is not operational (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:55-60`).

3. **What is the v1 schema/public-create compatibility window?** **Recommendation:** one released cohort of dual-read/legacy-write, followed by at least two cohorts that read v1/v2 and can down-project; only then may v2 become default, and removal waits for adoption evidence. The package already publishes multiple runtime/type subpaths and stable result shapes (`packages/toolkit/create/package.json:22-70`, `packages/toolkit/create/src/ultramodern-workspace/types.ts:145-214`).

4. **Must GraphQL ship in the first MicroVertical GA?** **Recommendation: no.** Ship the protocol SPI plus REST/HttpApi and RPC adapters; activate GraphQL with the first real adopter so its compatibility/security/client contract is concrete. Current code has HttpApi generation and RPC runtime primitives but no GraphQL path (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:109-135`, `packages/cli/plugin-bff/src/runtime/effect/handler/rpc.ts:9-44`).

5. **Which in-zone operations may degrade during N/N-1 rollout?** **Recommendation:** degraded behavior is acceptable for explicitly classified noncritical consumption; critical business operations must use temporary expand/contract compatibility through the rollout window even though no permanent in-zone compatibility promise exists. Source-level coordination and independent deploy skew are both binding (`CONTEXT.md:34-35`, `docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:40-51`).

## Could not verify

- **Live Zephyr snapshot/tag pointer switching:** no credentials or deployed public surfaces were exercised; ADR-0018 says that proof remains credential/public-URL gated (`docs/super-app-rfc-adr/ADR-0018-backend-federation-contract.md:156-160`).
- **Private cross-repo global graph closure:** no external private repositories or attestation registry were present; the local checkout can prove only local edges/cycles (`CONTEXT.md:19-23`).
- **Foreign MF-host interoperability:** current generation emits MF artifacts, but no foreign host acceptance test exists; this remains MV-G27 (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:64-66`).
- **The alleged two-independent-TanStack-app failure:** registry implementation and unit semantics were verified, but no failing realm-level reproduction exists (`packages/runtime/plugin-runtime/tests/router/provider.test.ts:135-253`).
- **External-major retirement safety:** no authoritative known-consumer inventory or support window exists in ADR-0020 (`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md:55-60`).
- **Whether the version constants are the newest packages available on public registries on 2026-07-10:** this was a local code/contract audit; exact/caret/prerelease forms were verified, not registry freshness (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:6-34`).
- **Runtime behavior from executing tests/builds:** this report re-verified source and test contracts but made no framework changes and did not run package builds, integration suites, browser smoke, or deployment proofs. The plan therefore distinguishes source-verified facts from future CI exit criteria.
- **Downstream Tractor behavior:** it was not checked because this task changed no generator/runtime/tooling code. It is mandatory acceptance for every implementation phase that does.
