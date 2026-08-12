# MicroVertical Gap Analysis - 2026-07-09

## Scope and Evidence Rules

This report compares the current `main-ultramodern` repository state with the clarified MicroVertical target model in `CONTEXT.md`, `docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md`, and `docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md`. The binding target says a MicroVertical may be headless, owns all shipped UI/API/server surfaces as one versioned unit, and must not mix revisions across those surfaces (`CONTEXT.md:7`, `ADR-0019:19-21`). It also says vertical boundaries cannot assume monorepo co-location (`CONTEXT.md:19`), dependencies are real consumption rather than manifest declarations (`CONTEXT.md:22`), external publication must be explicit and semver-governed (`CONTEXT.md:37`, `ADR-0020:53-66`), and shells are thin delivery units with no business capability (`CONTEXT.md:62`).

The requested backend-federation and TanStack package names are stale relative to this checkout: backend federation is under `packages/cli/plugin-bff/src/runtime/effect/**`, while `packages/server/plugin-bff` has no matching backend-federation files in this tree; TanStack provider registration is under `packages/runtime/plugin-tanstack` (`packages/runtime/plugin-tanstack/package.json:2`, `packages/runtime/plugin-tanstack/package.json:9`), not `packages/cli/plugin-tanstack-router`.

No tests, generators, downstream demos, or live Zephyr flows were run for this report. The task asked for report-only analysis.

## Executive Summary: Top 10 Gaps by Leverage

1. **No first-class surface/delivery-unit model.** The core generator model is still `WorkspaceApp` with `kind: 'shell' | 'vertical'`, optional `exposes`, optional `api`, and team-shaped ownership (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-48`, `packages/toolkit/create/src/ultramodern-workspace/types.ts:50-54`, `packages/toolkit/create/src/ultramodern-workspace/types.ts:58-67`). Delivery-unit records exist, but topology and sync only stamp them for API-bearing apps (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:286-292`, `packages/toolkit/create/src/ultramodern-workspace/workspace-validation-contract.ts:42-56`, `packages/toolkit/create/src/ultramodern-workspace/delivery-unit-sync.ts:127-131`).

2. **Headless/API-only MicroVerticals are not generated.** The target explicitly allows headless MicroVerticals (`CONTEXT.md:7`, `CONTEXT.md:46-48`), but `createRemoteDescriptor` always emits UI exposes plus an API (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:97-104`), `AddUltramodernVerticalOptions` has no surface/headless mode (`packages/toolkit/create/src/ultramodern-workspace/types.ts:136-143`), and `writeApp` always writes route and Module Federation files for apps (`packages/toolkit/create/src/ultramodern-workspace/write-app.ts:197-204`, `packages/toolkit/create/src/ultramodern-workspace/write-app.ts:217-220`, `packages/toolkit/create/src/ultramodern-workspace/write-app.ts:239-242`, `packages/toolkit/create/src/ultramodern-workspace/write-app.ts:302-307`).

3. **Current topology still encodes dependency-like declarations.** The target says dependencies are emergent from real consumption and manifests never declare dependence (`CONTEXT.md:22-23`), but generated topology writes `shell.verticalRefs`, `moduleFederation.remotes`, and API `consumedBy` (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:66-74`, `packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:129-132`), `add-vertical` mutates those declarations (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:65-81`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:95-98`), and the generated validator asserts the declared refs as truth (`packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:2324-2329`).

4. **No real-import/real-consumption graph cycle detector exists in the inspected paths.** Existing boundary guards extract import specifiers (`scripts/boundary-guards/validator.js:70-83`) but only apply configured banned regex patterns (`scripts/boundary-guards/validator.js:148-195`, `scripts/boundary-guards/profile.json:3-18`). The UltraModern divergence checker is about upstream-owned files importing fork-only markers (`scripts/ultramodern-boundary-check/README.md:3-9`, `scripts/ultramodern-boundary-check/checker.js:13-24`, `scripts/ultramodern-boundary-check/checker.js:108-143`), not vertical cycle detection.

5. **ADR-0020 external publication zoning is absent from current schemas and gates.** ADR-0020 requires explicit externally-published markers, semver, side-by-side majors, and CI that distinguishes internal and external zones (`ADR-0020:53-66`, `ADR-0020:77-82`). Current `WorkspaceApp`/`WorkspaceApi` do not model publication zone, semver major, or external baseline compatibility (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-54`), generated app packages are private fixed `0.1.0` packages (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:181-183`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:291-293`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:331-333`), and `publicSurface` is route SEO/public-output metadata, not external stability (`packages/toolkit/create/src/ultramodern-workspace/public-surface.ts:139-155`).

6. **Separate-repo vertical workflow is missing beyond partial cross-project BFF SDK support.** The target forbids co-location assumptions (`CONTEXT.md:19`), but `add-vertical` reads and writes local topology, ownership, overlay, shell, package, and tsconfig files under one `workspaceRoot` (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/constants.ts:1-5`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/preflight.ts:55-72`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:56-64`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/shell-files.ts:60-80`). Cross-project API SDK consumption exists for BFF (`packages/cli/plugin-bff/src/utils/crossProjectApiPlugin.ts:21-31`, `packages/cli/plugin-bff/src/utils/crossProjectApiPlugin.ts:54-84`), but there is no corresponding first-class separate-repo surface publish/consume workflow in the generator model.

7. **Full-mesh consumption is data-modeled weakly and generated only shell-centric.** The target allows any vertical, shell, or external app to consume any published surface (`CONTEXT.md:43`). `WorkspaceApp` can carry `verticalRefs` (`packages/toolkit/create/src/ultramodern-workspace/types.ts:46`), and remotes can resolve refs (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-160`), but the `add-vertical` workflow mutates only `topology.shell.verticalRefs` and shell remotes (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:65-81`) and rewrites the singleton shell app (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/shell-files.ts:60-68`).

8. **Router provider registry remains realm-global and single non-default.** The old hook-split concern is partly refuted because TanStack re-exports canonical runtime hooks (`packages/runtime/plugin-tanstack/src/runtime/hooks.ts:1-17`), but provider registration still uses a `globalThis` `Symbol.for` registry (`packages/runtime/plugin-runtime/src/router/runtime/provider.ts:95-107`), keeps first same-name provider (`packages/runtime/plugin-runtime/src/router/runtime/provider.ts:115-132`), and permits only one non-default provider per JS realm (`packages/runtime/plugin-runtime/src/router/runtime/provider.ts:135-145`). Tests lock in keep-first and local default mitigation for the default provider (`packages/runtime/plugin-runtime/tests/router/provider.test.ts:135-153`, `packages/runtime/plugin-runtime/tests/router/provider.test.ts:194-204`), but not independent per-vertical TanStack provider scopes.

9. **Degraded state and rollback are partial, not mandatory at every consumption point.** The target requires degraded behavior at each consumption point and near-instant per-unit rollback (`CONTEXT.md:28-31`). Generated shell widget helpers include fallback telemetry for widget loading (`packages/toolkit/create/templates/workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx.handlebars:8-24`, `packages/toolkit/create/templates/workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx.handlebars:26-41`, `packages/toolkit/create/templates/workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx.handlebars:75-77`), and backend manifest loading has typed fallback (`packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/errors.ts:3-16`, `packages/cli/plugin-bff/tests/backend-federation-runtime.test.ts:429-458`). There is still no unified framework-owned consumption API that forces degraded state for every UI/API/server load, and the current resolver is environment URL based rather than a Zephyr pointer-flip provider (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-58`, `ADR-0012-mv-topology-manifest-and-zephyr-profile.md:3`, `ADR-0012-mv-topology-manifest-and-zephyr-profile.md:64-69`).

10. **Script families are active but mostly static gates, and old `scripts/mv-*` machinery is gone.** There are no current `scripts/mv-*` directories in this checkout; ADR-0012 says the old `scripts/mv-zephyr-profile` validator was deleted and the topology schema became documentation-only (`docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md:3`). Active package scripts wire boundary guards, divergence guards, release gates, superapp certification, production readiness, and publish proof (`package.json:49-69`), but release-gate migration checks are file/snippet checks (`scripts/release-gates/validator/migration.js:102-109`) rather than semantic MicroVertical graph, zone, or external surface validators.

## Point 1: MicroVertical as End-to-End Business Capability, Headless Valid

### Current State

The source of truth defines a MicroVertical as a business capability owned by one owner, delivered as one versioned unit, with optional user-facing surface and UI/API/server surfaces from one source revision (`CONTEXT.md:7-10`). The current generator core type is `WorkspaceApp`, with only `shell` or `vertical` kinds, optional `exposes`, optional `api`, optional `verticalRefs`, and `ownership` (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-48`). `WorkspaceApi` only models `stem`, `prefix`, and `consumedBy` (`packages/toolkit/create/src/ultramodern-workspace/types.ts:50-54`), and `Ownership` is team/contact/blast-radius metadata rather than owner kind/id (`packages/toolkit/create/src/ultramodern-workspace/types.ts:58-67`).

`createDeliveryUnitRecord` creates a delivery-unit identity with `unitId`, package name, version, source revision, build marker, and deploy profile (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts:29-43`). Backend federation then uses that identity in generated execution overlays (`packages/toolkit/create/src/ultramodern-workspace/backend-federation.ts:125-144`) and validates expected identity through the manifest adapter (`packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/reference.ts:62-83`, `packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/validation.ts:139-159`).

### Conforms

- The repository has a concrete delivery-unit record primitive that aligns with ADR-0019's single identity root (`packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts:29-43`, `ADR-0019:19-21`).
- Backend federation can enforce expected `unitId` and `buildMarker` for manifest-based loading (`packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/reference.ts:77-83`, `packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/validation.ts:151-159`).
- Generated validator checks delivery-unit identity in compact config and backend-federation metadata for API-bearing verticals (`packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:2382-2408`).

### Contradicts

- Headless validity is not represented in `AddUltramodernVerticalOptions`, which accepts only workspace root, name, version, Tailwind, overlays, and package source (`packages/toolkit/create/src/ultramodern-workspace/types.ts:136-143`).
- The default vertical descriptor always has UI exposes `./Route` and `./Widget` plus an API prefix (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:97-104`), which contradicts the target that user-facing surface is optional (`CONTEXT.md:7`).
- `writeApp` always writes UI route files and Module Federation config for every generated app (`packages/toolkit/create/src/ultramodern-workspace/write-app.ts:197-204`, `packages/toolkit/create/src/ultramodern-workspace/write-app.ts:217-220`, `packages/toolkit/create/src/ultramodern-workspace/write-app.ts:239-242`).
- Delivery-unit identity is API-gated in topology and validation, so UI-only verticals, headless non-Effect verticals, shells, and horizontal remotes are not treated uniformly as delivery units (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:286-292`, `packages/toolkit/create/src/ultramodern-workspace/workspace-validation-contract.ts:42-56`, `packages/toolkit/create/src/ultramodern-workspace/delivery-unit-sync.ts:127-131`), while the target says a delivery unit may be a MicroVertical, Shell, or Horizontal Remote (`CONTEXT.md:40`).

### Missing

- A `DeliveryUnit`/`Surface` descriptor separate from app scaffolding is missing from the public generator model; `WorkspaceApp` is still app-shaped (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-48`).
- Owner kind/id is missing; current ownership is team/contact metadata (`packages/toolkit/create/src/ultramodern-workspace/types.ts:58-67`), while the target owner can be a team, agent, or agent team and may own multiple verticals (`CONTEXT.md:10`).
- Horizontal Remote is a target delivery-unit kind (`CONTEXT.md:65`), but the current app kind union has no horizontal remote kind (`packages/toolkit/create/src/ultramodern-workspace/types.ts:39`).

### Work Items

- **MV-G1, L:** Introduce a first-class delivery-unit and surface schema with `deliveryUnitKind`, `owner`, `surfaces`, `publicationZone`, `sourceRevision`, and `baselineCompatibility`; replace API-gated delivery-unit stamping in `contracts.ts`, `workspace-validation-contract.ts`, and `delivery-unit-sync.ts`.
- **MV-G2, M:** Add vertical generation modes for `api-only`, `ui-only`, `full-stack`, and `horizontal-remote`; thread them through `AddUltramodernVerticalOptions`, descriptors, `writeApp`, topology, and generated validator.
- **MV-G3, S:** Rename or extend ownership schema from team-shaped contact metadata to target `Owner` with `kind`, `id`, contacts, and one-owner-many-verticals semantics.

## Point 2: Isolation Boundary, Published Surfaces Only, No Co-location Assumptions

### Current State

The target boundary says MicroVerticals may depend on other verticals only through published surfaces and may live in separate repos, so boundary checks must not assume one workspace (`CONTEXT.md:19-23`). The active boundary guard extracts imports from JS/TS content (`scripts/boundary-guards/validator.js:70-83`) and applies profile-defined banned import regexes over framework package roots (`scripts/boundary-guards/profile.json:3-18`, `scripts/boundary-guards/validator.js:148-195`). ADR-0015 records that the old ownership/blast-radius validator was retired before implementation and that the ownership schema is schema-only with zero code consumers (`docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md:3`).

The generator assumes local workspace state for `add-vertical`: it reads `topology/reference-topology.json`, `topology/ownership.json`, and `topology/local-overlays/development.json` from `workspaceRoot` (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/constants.ts:1-5`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/preflight.ts:55-72`), writes a new local app under the workspace (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:56-64`), and rewrites shell app files in the same repo (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/shell-files.ts:60-80`).

### Conforms

- There is a general import-specifier extraction utility that can be reused for boundary checks (`scripts/boundary-guards/validator.js:70-83`).
- The boundary guard is wired in package scripts and CI (`package.json:49-51`, `.github/workflows/boundary-anti-patterns.yml:45-50`).
- `ultramodern-boundary-check` protects fork/upstream ownership boundaries by comparing new fork-only import markers against an allowlist (`scripts/ultramodern-boundary-check/README.md:3-9`, `scripts/ultramodern-boundary-check/checker.js:217-225`).

### Contradicts

- Current `add-vertical` is a co-located workspace mutator, not a separate-repo workflow (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/preflight.ts:55-72`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:98-100`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/shell-files.ts:60-80`).
- The root workspace generator writes `apps/*`, `verticals/*`, and `packages/*` workspace globs for bridge mode (`packages/toolkit/create/src/ultramodern-workspace/write-workspace.ts:163-170`), which is useful locally but cannot be the only boundary assumption for separate-repo verticals (`CONTEXT.md:19`).
- No active gate maps imports to vertical ownership and rejects vertical-to-vertical source imports; ADR-0015 explicitly says that machinery was removed before implementation (`docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md:3`, `docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md:47-55`).

### Missing

- A vertical ownership/path map consumed by source-import boundary validation is missing from active code; current ownership output exists as generated metadata but not as a source import gate (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:60-61`, `scripts/boundary-guards/profile.json:3-18`).
- A separate-repo publisher/consumer command path is missing from `add-vertical`; the current option shape contains no external workspace, manifest source, or remote package input (`packages/toolkit/create/src/ultramodern-workspace/types.ts:136-143`).

### Work Items

- **MV-G4, L:** Build a real isolation-boundary gate that maps source files to delivery-unit owners and rejects cross-vertical source imports while allowing published surface imports.
- **MV-G5, M:** Add separate-repo publish/consume commands that operate on external manifest/package metadata without mutating the local shell workspace.
- **MV-G6, M:** Rewire `scripts/boundary-guards` from domain-neutral regex guards to include optional MicroVertical ownership/path import checks; keep the current regex mode as a lightweight framework anti-pattern gate.

## Point 3: Full-Mesh Consumption and Per-Vertical API Protocol Choice

### Current State

The target says any MicroVertical, shell, or external app may consume any published surface (`CONTEXT.md:43`), and each vertical may choose GraphQL, REST, or RPC for API surfaces (`CONTEXT.md:46-48`). Current `WorkspaceApp` can carry `verticalRefs` (`packages/toolkit/create/src/ultramodern-workspace/types.ts:46`) and resolver code maps those ids to remotes (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-160`). However, the generated workflow is shell-centric: `add-vertical` always pushes the new vertical into `topology.shell.verticalRefs` and `topology.shell.moduleFederation.remotes` (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:65-81`) and rewrites the singleton shell (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/shell-files.ts:60-68`).

Generated API metadata is fixed to Effect/HttpApi: `apiTopologyMetadata` emits `runtime: 'effect'`, BFF prefix/OpenAPI, contract path, client path, server entry, base path, and `consumedBy` (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:109-135`). The generated API contract uses `HttpApi.make`, `HttpApiGroup.make`, and `HttpApiEndpoint.get/post` (`packages/toolkit/create/src/ultramodern-workspace/api/shared.ts:161-194`). Plugin-bff has RPC plumbing (`packages/cli/plugin-bff/src/runtime/effect/handler/types.ts:107-115`, `packages/cli/plugin-bff/src/runtime/effect/handler/rpc.ts:19-28`), but the generator does not expose a protocol choice in `WorkspaceApi` (`packages/toolkit/create/src/ultramodern-workspace/types.ts:50-54`).

### Conforms

- The data model has a weak ability to represent app-to-app remote refs (`packages/toolkit/create/src/ultramodern-workspace/types.ts:46`, `packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-160`).
- API clients can be consumed cross-project through generated SDK plugin paths (`packages/cli/plugin-bff/src/utils/crossProjectApiPlugin.ts:21-31`, `packages/cli/plugin-bff/src/utils/crossProjectApiPlugin.ts:54-84`).
- Backend runtime has an RPC handler path that could become one protocol option (`packages/cli/plugin-bff/src/runtime/effect/handler/rpc.ts:19-28`).

### Contradicts

- `add-vertical` only updates shell refs/remotes rather than allowing arbitrary consumer verticals or external apps to declare consumption intent for scaffolding (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:65-81`).
- `WorkspaceApi` has no `protocol` field (`packages/toolkit/create/src/ultramodern-workspace/types.ts:50-54`), while the target assigns API protocol choice to each MicroVertical (`CONTEXT.md:46-48`).
- Generated APIs are Effect HttpApi/OpenAPI only (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:115-131`, `packages/toolkit/create/src/ultramodern-workspace/api/shared.ts:161-194`).

### Missing

- No GraphQL generation or consumption path was found in the inspected generator/API runtime files; the only generated protocol is Effect HttpApi (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:109-135`).
- No generated full-mesh vertical-to-vertical UI consumption test exists in `tests/integration/create-ultramodern-workspace`; current visible tests create workspace/add verticals and run the generated validator (`tests/integration/create-ultramodern-workspace/tests/index.test.ts:108-120`, `tests/integration/create-ultramodern-workspace/tests/index.test.ts:385-396`).

### Work Items

- **MV-G7, L:** Add protocol metadata to `WorkspaceApi` and implement generator/runtime paths for Effect HttpApi/REST, Effect RPC, and GraphQL.
- **MV-G8, M:** Add a surface consumption command or config path for any consumer delivery unit, not just the shell, and update MF config generation accordingly.
- **MV-G9, M:** Add integration tests for vertical-to-vertical consumption, shell-to-vertical consumption, and external app consumption using the same logical surface resolver.

## Point 4: No Manifest-Declared Dependencies, Real Graph Cycle Detection

### Current State

The target says a vertical dependency exists only when a published surface is actually consumed, manifests never declare dependency, and cross-vertical import cycles must be detected from the real graph (`CONTEXT.md:22-23`). Current topology emits `shell.verticalRefs` and `moduleFederation.remotes` (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:66-74`), vertical topology entries can include `moduleFederation.verticalRefs` and `remotes` (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/topology.ts:35-45`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/topology.ts:133-140`), and generated validation asserts those declared refs (`packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:2324-2329`).

The boundary guard extracts import specifiers (`scripts/boundary-guards/validator.js:70-83`) but validates configured banned patterns and snippets (`scripts/boundary-guards/profile.json:3-18`, `scripts/boundary-guards/profile.json:19-49`). The generated validator also checks TypeScript project references against expected generated references (`packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:1340-1344`), which is a declared project graph, not real surface consumption.

### Conforms

- Import extraction exists and can be a starting primitive for real graph analysis (`scripts/boundary-guards/validator.js:70-83`).
- Module Federation exposes and remotes are explicit enough to seed a surface resolver, if reclassified as resolution metadata rather than dependency truth (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/topology.ts:35-45`).

### Contradicts

- `verticalRefs` and `remotes` are emitted and validated as declared consumption (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:70-74`, `packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:2324-2329`), contradicting the target's "manifests never declare dependence" rule (`CONTEXT.md:22`).
- API `consumedBy` is declared in API topology metadata (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:129-132`), which is useful documentation but not the target's real consumption graph.

### Missing

- No active graph builder maps imports, MF load specifiers, generated API clients, and external logical surface references into a real directed consumption graph.
- No active cycle detector rejects `A -> B -> A` cross-vertical consumption; ADR-0015 says the old ownership/graph-aware gate was never implemented (`docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md:3`, `docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md:19-25`).

### Work Items

- **MV-G10, L:** Implement a real consumption graph extractor over source imports, MF specifiers, generated client imports, and external surface references.
- **MV-G11, M:** Reclassify topology `verticalRefs`, `remotes`, and `consumedBy` from dependency truth into generated resolution hints or remove them where graph extraction can derive truth.
- **MV-G12, M:** Add CI cycle detection with failing fixtures for cross-vertical import cycles, MF consumption cycles, and API client cycles.

## Point 5: Zoned Versioning, Internal Breakage vs Externally Published Surfaces

### Current State

The target divides surfaces into Coordinated Zone and Externally Published Surface: in-repo breaking changes are allowed when consumers are updated in the same commit, while external surfaces require explicit marking, semver, and side-by-side majors (`CONTEXT.md:34-38`, `ADR-0020:40-66`). ADR-0020 also requires CI to distinguish those zones (`ADR-0020:77-82`).

Current schema lacks fields for external publication or major versioning: `WorkspaceApp` has id/path/package/kind/exposes/api/refs/ownership, and `WorkspaceApi` has stem/prefix/consumedBy only (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-54`). Generated app packages are private with fixed `0.1.0` versions (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:181-183`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:291-293`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:331-333`). `createPublicSurfaceContract` describes public web output files and SEO/public-route assets, not external stability (`packages/toolkit/create/src/ultramodern-workspace/public-surface.ts:139-155`).

### Conforms

- Delivery-unit identity validation provides a safety net for runtime skew (`packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:2382-2408`, `ADR-0020:80-82`).
- Cross-project BFF policy has operation-version concepts for generated SDK consumers (`packages/cli/plugin-bff/src/utils/crossProjectApiPlugin.ts:64-84`), but this is not an ADR-0020 external surface marker.

### Contradicts

- No explicit `externallyPublished`/`publicationZone`/`semverMajor` field exists in the inspected surface model (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-54`), contradicting ADR-0020's explicit marking requirement (`ADR-0020:55-57`).
- Generated package metadata is private and fixed-version (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:181-183`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:291-293`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:331-333`), so it cannot express semver-governed published surfaces as generated today.
- Release gates are static file/snippet checks (`scripts/release-gates/validator/migration.js:102-109`) rather than API/MF/RPC surface diff checks by zone.

### Missing

- No CI gate diffing previous external surface contracts against current contracts with side-by-side major enforcement.
- No generated side-by-side major naming policy for MF expose paths, API route prefixes, or RPC contracts, despite ADR-0020 defining those materialization options (`ADR-0020:61-63`).
- No external baseline compatibility range field for platform baseline dependencies, despite the target requiring externally published MicroVerticals to declare compatible baseline ranges (`CONTEXT.md:56`).

### Work Items

- **MV-G13, L:** Add external publication metadata to surface descriptors and generated manifests.
- **MV-G14, L:** Implement ADR-0020 CI diff gate that classifies internal vs external surfaces and enforces side-by-side majors for external breaking changes.
- **MV-G15, M:** Add baseline compatibility range metadata to external surfaces and validate it against centralized platform versions.

## Point 6: Platform Baseline

### Current State

The target baseline is React, TanStack Router, Effect, and Tailwind pinned centrally, while non-baseline choices remain per vertical (`CONTEXT.md:56-57`). Current generator versions are centralized in `versions.ts`, including TanStack Router, Tailwind, Effect, Drizzle, and React/React Router versions (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:6-18`, `packages/toolkit/create/src/ultramodern-workspace/versions.ts:28-31`, `packages/toolkit/create/src/ultramodern-workspace/versions.ts:40-47`). Generated app dependencies include Modern runtime/plugin packages, Module Federation, TanStack Router, React, React DOM, and React Router (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:55-79`), and plugin-bff is added conditionally for API/shell cases (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:91-109`).

Tailwind prefixes are derived per app and collision-checked (`packages/toolkit/create/src/ultramodern-workspace/naming.ts:69-103`), app CSS imports Tailwind with `prefix(...)` (`packages/toolkit/create/src/ultramodern-workspace/app-files.ts:146-147`), and integration tests verify numbered vertical prefixes stay unique (`tests/integration/create-ultramodern-workspace/tests/index.test.ts:399-421`).

### Conforms

- Baseline dependency versions are centralized in one generator module (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:1-18`).
- Generated apps consume React, TanStack Router, Effect-related packages, Tailwind tooling, and Module Federation through generator-controlled package plans (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:55-79`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:122-139`).
- Tailwind per-vertical prefixing is implemented and tested (`packages/toolkit/create/src/ultramodern-workspace/naming.ts:82-103`, `packages/toolkit/create/src/ultramodern-workspace/app-files.ts:146-147`, `tests/integration/create-ultramodern-workspace/tests/index.test.ts:399-421`).

### Contradicts

- React is centralized but expressed as a caret range (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:28-31`), while the target says the baseline is pinned and moved centrally (`CONTEXT.md:56`). That may be acceptable package-manager policy, but it is not an exact pin in the current constant.
- The generator currently fixes API runtime to Effect HttpApi instead of leaving API protocol choice per vertical (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:115-131`, `CONTEXT.md:46-48`).

### Missing

- No external-surface baseline compatibility range exists for externally published MicroVerticals (`packages/toolkit/create/src/ultramodern-workspace/types.ts:34-54`, `CONTEXT.md:56`).
- No gate verifies that a vertical cannot override baseline React/router/Effect/Tailwind versions after generation; current validation focuses generated workspace shape and package cohort alignment, not external baseline compatibility (`packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars:2378-2408`).

### Work Items

- **MV-G16, S:** Decide whether baseline constants must be exact pins or allowed semver ranges; make React/React DOM policy match the target wording.
- **MV-G17, M:** Add baseline override detection to generated validators for React, TanStack Router, Effect, and Tailwind.
- **MV-G18, M:** Add external baseline compatibility metadata and validation for externally published surfaces.

## Point 7: Platform Overlay, Downstream Narrowing, Auth Not Base

### Current State

The target says overlays may narrow base choices but never relax the baseline, and authentication deliberately stays outside the UltraModern base (`CONTEXT.md:59-60`). The current generator has an `overlays?: UltramodernCodeSmithOverlay[]` option at workspace and add-vertical entry points (`packages/toolkit/create/src/ultramodern-workspace/types.ts:120-126`, `packages/toolkit/create/src/ultramodern-workspace/types.ts:136-142`), but that is a CodeSmith template overlay hook rather than a target-level Platform Overlay contract.

Generated app dependencies do not include an auth stack in the baseline dependency list (`packages/toolkit/create/src/ultramodern-workspace/package-json.ts:55-79`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:122-139`). A targeted generator/runtime search found only an `authorization` header field in API request context (`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts:31`) and no Better Auth baseline package in the inspected generator files.

### Conforms

- Auth is not currently a generated baseline dependency, matching the target's "auth outside baseline" rule (`CONTEXT.md:59-60`, `packages/toolkit/create/src/ultramodern-workspace/package-json.ts:55-79`).
- The generator already has an overlay extension point in options (`packages/toolkit/create/src/ultramodern-workspace/types.ts:120-126`, `packages/toolkit/create/src/ultramodern-workspace/types.ts:136-142`).

### Contradicts

- The current overlay option does not model overlay constraints over baseline dependency versions, allowed API protocols, ORM choices, auth choices, or generator modes; it is not a Platform Overlay contract (`packages/toolkit/create/src/ultramodern-workspace/types.ts:120-126`).
- Drizzle is centrally versioned in baseline constants (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:18`, `packages/toolkit/create/src/ultramodern-workspace/versions.ts:45`), but the target treats persistence tooling as per-vertical unless narrowed by an overlay (`CONTEXT.md:56-59`). This is not necessarily wrong if Drizzle is only template data, but the current model does not distinguish baseline from overlay-owned opinions.

### Missing

- No overlay manifest or validator records "this downstream overlay narrows base freedom X"; current generated topology and config do not carry overlay policy.
- No check prevents an overlay from relaxing baseline React/TanStack/Effect/Tailwind versions; the baseline is centralized but overlay semantics are not.

### Work Items

- **MV-G19, M:** Add a Platform Overlay contract distinct from CodeSmith overlays, with allowed narrowed choices and explicit non-relaxation checks.
- **MV-G20, S:** Classify current centrally versioned non-baseline tools, such as Drizzle constants, as either template defaults or overlay-owned policy.
- **MV-G21, M:** Add overlay validation to generated workspace checks and release gates.

## Point 8: Degraded State Mandatory and Per-Unit Rollback

### Current State

The target treats absence or incompatibility of a consumed surface as normal degraded state and requires each consumption point to define behavior (`CONTEXT.md:28-31`). Generated shell widget helper templates create fallback telemetry and fallback UI for remote component load failures (`packages/toolkit/create/templates/workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx.handlebars:8-24`, `packages/toolkit/create/templates/workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx.handlebars:26-41`). Runtime exposes Module Federation fallback telemetry helpers (`packages/runtime/plugin-runtime/src/module-federation/index.ts:14-38`, `packages/runtime/plugin-runtime/src/module-federation/index.ts:191-201`, `packages/runtime/plugin-runtime/src/module-federation/index.ts:204-220`).

Backend federation manifest loading has typed adapter errors and supports fallback functions (`packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/errors.ts:3-16`, `packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/load.ts:22-67`), and tests cover typed fallback for a version-boundary mismatch (`packages/cli/plugin-bff/tests/backend-federation-runtime.test.ts:429-458`). The lower-level direct backend loader validates strict Effect shape but does not enforce delivery-unit identity unless callers go through the manifest adapter (`packages/cli/plugin-bff/src/runtime/effect/backend-federation/load.ts:25-67`).

Rollback resolution is currently based on environment/public/local manifest URL generation (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-58`) and local development overlays (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:171-200`). ADR-0012 records that the old topology/Zephyr profile validator was deleted and schema-only (`docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md:3`), though it describes last-known-good fallback as a historical requirement (`docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md:64-69`).

### Conforms

- Shell widget consumption generated by the default shell has fallback UI and telemetry (`packages/toolkit/create/templates/workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx.handlebars:8-41`).
- Backend manifest consumption can degrade through typed fallback (`packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/errors.ts:3-16`, `packages/cli/plugin-bff/tests/backend-federation-runtime.test.ts:429-458`).
- Runtime telemetry primitives can classify and emit MF fallback events (`packages/runtime/plugin-runtime/src/module-federation/index.ts:14-38`, `packages/runtime/plugin-runtime/src/module-federation/index.ts:204-220`).

### Contradicts

- Degraded state is not mandatory for every consumption point; the reusable shell helper only covers generated shell widget remotes, while test fixtures still wrap remotes manually (`tests/integration/routes-tanstack-mf/mf-host/src/routes/mf/page.tsx:95-109`, `tests/integration/routes-tanstack-mf/mf-host/src/routes/mf/remoteLoader.tsx:1-19`).
- The direct backend loader can load and shape-check a remote without expected delivery-unit identity enforcement (`packages/cli/plugin-bff/src/runtime/effect/backend-federation/load.ts:25-67`), while ADR-0019 requires identity to prevent mixed UI/API/backend states (`ADR-0019:19-21`, `ADR-0019:38-47`).
- The current rollback seam is environment URL selection, not a generalized pointer-flip provider with Zephyr optional (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-58`, `CONTEXT.md:25-31`).

### Missing

- No framework-owned `consumeSurface` API forces fallback/degraded behavior for UI, API, and backend surfaces.
- No generated or CI-validated rollback contract covers Zephyr pointer flip, env-manifest fallback, stale manifest, incompatible manifest, and last-known-good snapshot as one matrix.
- No per-consumption-point static check verifies that every logical surface load has a fallback/degraded handler.

### Work Items

- **MV-G22, L:** Introduce a framework-owned surface consumption API that requires degraded behavior and telemetry for UI/API/backend loads.
- **MV-G23, M:** Make backend delivery-unit enforcement mandatory for all public backend federation loading paths or mark direct loader internal/test-only.
- **MV-G24, L:** Implement a resolver/rollback provider abstraction with env-manifest baseline and optional Zephyr/LKG providers, plus matrix tests.

## Point 9: Surface Resolution via Logical Names, Env Baseline, Zephyr Optional, MF Manifest Canonical

### Current State

The target says consumers refer to logical surface names and a pluggable seam resolves them to artifacts; env-configured manifest URLs are baseline, Zephyr is optional, `mf-manifest.json` is canonical, and `remoteEntry.js` must support foreign MF runtimes (`CONTEXT.md:25-26`, `ADR-0020:64-66`). Current UI Module Federation config emits `remoteEntry.js` for shell and remotes (`packages/toolkit/create/src/ultramodern-workspace/module-federation/config.ts:173-176`, `packages/toolkit/create/src/ultramodern-workspace/module-federation/config.ts:273-277`). Backend config emits `backendRemoteEntry.mjs` (`packages/toolkit/create/src/ultramodern-workspace/module-federation/config.ts:200-206`), and backend manifest URLs use `backend-mf-manifest.json` (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:180`).

Remote URL helper generation resolves from configured env var, public URL env, Cloudflare workers dev subdomain, or localhost fallback (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-58`). However, consumers are still wired through `verticalRefs` and generated remotes rather than a pluggable logical surface resolver (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-160`, `packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:11-17`).

### Conforms

- Env-configured manifest URL baseline exists (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-40`).
- `mf-manifest.json` URL forms are canonical in generated topology/overlay and remote URL helper code (`packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:77-89`, `packages/toolkit/create/src/ultramodern-workspace/contracts.ts:182-187`).
- `remoteEntry.js` is emitted for UI MF compatibility (`packages/toolkit/create/src/ultramodern-workspace/module-federation/config.ts:173-176`, `packages/toolkit/create/src/ultramodern-workspace/module-federation/config.ts:273-277`).

### Contradicts

- Consumers are generated from concrete `verticalRefs`/remote ids rather than only logical surface names (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:139-160`, `packages/toolkit/create/src/ultramodern-workspace/add-vertical/execute.ts:65-81`).
- Zephyr is a dependency/tooling concept but not a first-class resolution provider in the inspected generated surface resolution path; the old Zephyr topology validator is retired (`packages/toolkit/create/src/ultramodern-workspace/versions.ts:9-10`, `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md:3`).
- Backend and UI resolution paths are not unified: UI uses MF manifest URL helpers, while backend manifest loading has separate adapter types and validation (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-58`, `packages/cli/plugin-bff/src/runtime/effect/backend-federation-manifest/load.ts:22-67`).

### Missing

- No pluggable surface resolver interface that can swap env URL, Zephyr snapshot/tag, local dev, or LKG providers.
- No foreign-MF acceptance test proving `remoteEntry.js` + `mf-manifest.json` compatibility outside UltraModern-specific generated consumers.
- No logical surface naming schema that covers UI exposes, API protocols, backend execution surfaces, and horizontal remotes.

### Work Items

- **MV-G25, L:** Design and implement a logical surface resolver interface shared by UI and backend loading.
- **MV-G26, M:** Add Zephyr snapshot/tag provider as optional resolver, keeping env manifest URLs as baseline.
- **MV-G27, M:** Add foreign MF runtime acceptance tests for `mf-manifest.json` and `remoteEntry.js` surfaces.

## Point 10: Shell as Thin Composition Host, Own Delivery Unit, Multiple Shells Valid

### Current State

The target defines Shell as a thin composition host, its own delivery unit, not a MicroVertical, no business logic, and explicitly rejects the one-shell assumption (`CONTEXT.md:62-63`). Current generator hardcodes one `shellApp` descriptor (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:13-38`), `createShellHost` overlays vertical refs onto that singleton (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:40-44`), and workspace generation starts with `createdApps = [createShellHost(initialVerticals), ...initialVerticals]` where `initialVerticals` is empty (`packages/toolkit/create/src/ultramodern-workspace/write-workspace.ts:191-193`).

The shell owns top-level route metadata for `/` (`packages/toolkit/create/src/ultramodern-workspace/routes.ts:29-41`) and generated shell pages/components are demo-heavy: `createShellPage` renders a first-screen marketing/dashboard-style shell page (`packages/toolkit/create/src/ultramodern-workspace/demo-components.ts:16-42`), shell widget showcase code imports/remotes and renders vertical widgets (`packages/toolkit/create/src/ultramodern-workspace/demo-components.ts:64-115`), and `writeApp` emits shell-only `vertical-components.tsx`, `shell-frame.tsx`, and `src/api/vertical-clients.ts` (`packages/toolkit/create/src/ultramodern-workspace/write-app.ts:253-263`).

### Conforms

- Shell is modeled separately from vertical with `kind: 'shell'` (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:13-22`, `packages/toolkit/create/src/ultramodern-workspace/types.ts:39`).
- Shell owns top-level routing (`packages/toolkit/create/src/ultramodern-workspace/routes.ts:29-41`).
- Shell composes remote widgets through generated composition code (`packages/toolkit/create/src/ultramodern-workspace/demo-components.ts:64-115`).

### Contradicts

- The generator assumes one shell through singleton `shellApp` and `createShellHost` (`packages/toolkit/create/src/ultramodern-workspace/descriptors.ts:13-44`), contrary to "multiple shells valid" (`CONTEXT.md:62-63`).
- Shell delivery-unit identity is not stamped uniformly because delivery-unit records are API-gated (`packages/toolkit/create/src/ultramodern-workspace/contracts.ts:286-292`, `packages/toolkit/create/src/ultramodern-workspace/delivery-unit-sync.ts:127-131`), while target says a Shell is a delivery unit (`CONTEXT.md:40`, `CONTEXT.md:62`).
- The shell generator includes significant showcase/demo UI and API client wiring (`packages/toolkit/create/src/ultramodern-workspace/demo-components.ts:16-42`, `packages/toolkit/create/src/ultramodern-workspace/write-app.ts:253-263`), which is not the same as a thin composition host with zero business logic (`CONTEXT.md:62`).

### Missing

- No multi-shell generator option, topology schema path, or validation path was found in the inspected shell generation files.
- No shell-thinness gate detects business logic, direct API workflow logic, or domain calculations inside shell code.

### Work Items

- **MV-G28, L:** Replace singleton shell descriptor with a multi-shell model and shell generation command.
- **MV-G29, M:** Stamp shell delivery-unit identity and validate it independently of API-bearing verticals.
- **MV-G30, M:** Add shell-thinness lint/gate rules that allow composition/routing/baseline provisioning but reject domain workflow logic.

## Script Family Assessment

The known gap candidate described `scripts/mv-*` as active paperwork, but this current checkout has no `scripts/mv-*` directories. ADR-0012 records that `scripts/mv-zephyr-profile` was deleted and `contracts/mv-topology-manifest.schema.json` is documentation-only (`docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md:3`). ADR-0015 records that ownership/blast-radius validator machinery was never implemented and the ownership schema has zero code consumers (`docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md:3`).

| Script area | Current evidence | Decision |
| --- | --- | --- |
| `scripts/boundary-guards` | Wired in `package.json:49-51` and CI `.github/workflows/boundary-anti-patterns.yml:45-46`; validates regex import guards and required snippets (`scripts/boundary-guards/profile.json:3-49`). | Keep as lightweight anti-pattern guard; rewire if it becomes the MV source-import boundary gate. |
| `scripts/ultramodern-boundary-check` | README says it freezes upstream-owned source files importing UltraModern-only code (`scripts/ultramodern-boundary-check/README.md:3-9`); denylist includes UltraModern markers (`scripts/ultramodern-boundary-check/checker.js:13-24`). | Keep, but label as fork-divergence guard, not MV validation. |
| `scripts/release-gates` | Wired in `package.json:52` and `package.json:68`; workflow invokes `Validate Contract Gate` (`.github/workflows/contract-gates.yml:170-178`); migration checks are file/snippet based (`scripts/release-gates/validator/migration.js:102-109`). | Keep orchestration; rewire high-value gates to semantic schema, graph, and ADR-0020 external surface checks. |
| `scripts/superapp-certification` | Wired in `package.json:55-60`. | Keep as certification/report orchestration only if it invokes semantic MV gates; otherwise do not treat as proof of MV target conformance. |
| `scripts/ultramodern-production-readiness` | The publish workflow runs exact-artifact acceptance through `scripts/ultramodern-publish/run-release-acceptance.mjs`; the Tractor reusable workflow validates the published cohort downstream. | Keep as the release-acceptance implementation behind the publish and Tractor gates. |
| `scripts/ultramodern-publish` | Wired in package scripts for prepare/build/source proof/trusted publish (`package.json:61-64`). | Keep publish plumbing; do not treat as MV contract validation. |
| Historical `scripts/mv-*` | ADR-0012 says old `scripts/mv-zephyr-profile` was deleted (`docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md:3`). | Do not resurrect as paperwork; replace with semantic graph/resolution/zone gates. |

## Consolidated Work-Item Backlog

| ID | Gap | Size | Likely files touched | Depends on |
| --- | --- | --- | --- | --- |
| MV-G1 | First-class `DeliveryUnit` and `Surface` schema separate from `WorkspaceApp`. | L | `packages/toolkit/create/src/ultramodern-workspace/types.ts`, `contracts.ts`, `delivery-unit.ts`, `workspace-validation-contract.ts`, generated validator template | None |
| MV-G2 | Headless/API-only/UI-only/full-stack/horizontal remote generator modes. | M | `types.ts`, `descriptors.ts`, `write-app.ts`, `add-vertical/**`, tests | MV-G1 |
| MV-G3 | Owner model with team/agent kind and one-owner-many-verticals semantics. | S | `types.ts`, topology/ownership contract generation, validator template | MV-G1 |
| MV-G4 | Source-import isolation gate by delivery-unit owner. | L | `scripts/boundary-guards/**`, generated topology/ownership contracts, CI workflows | MV-G1, MV-G3 |
| MV-G5 | Separate-repo surface publish/consume workflow. | M | `ultramodern-tooling/**`, `add-vertical/**`, package/source config, tests | MV-G1, MV-G25 |
| MV-G6 | Rewire boundary guards for optional MV ownership/path import checks. | M | `scripts/boundary-guards/**`, `package.json`, CI | MV-G4 |
| MV-G7 | API protocol metadata and REST/RPC/GraphQL generation paths. | L | `types.ts`, `api/**`, `plugin-bff/**`, tests | MV-G1 |
| MV-G8 | Any-consumer surface consumption generation, not shell-only. | M | `descriptors.ts`, `module-federation/**`, `add-vertical/**`, shell/vertical templates | MV-G25 |
| MV-G9 | Full-mesh integration tests. | M | `tests/integration/create-ultramodern-workspace/**`, route/MF fixtures | MV-G8 |
| MV-G10 | Real consumption graph extractor. | L | new script/tooling package, `scripts/boundary-guards/**`, generated validator | MV-G1, MV-G8 |
| MV-G11 | Reclassify/remove manifest-declared dependency truth. | M | `contracts.ts`, `add-vertical/topology.ts`, validator template | MV-G10 |
| MV-G12 | Cross-vertical cycle detector and fixtures. | M | graph extractor tests, CI, `tests/integration/create-ultramodern-workspace/**` | MV-G10 |
| MV-G13 | External publication metadata on surfaces. | L | `types.ts`, `contracts.ts`, `api/contracts.ts`, MF config generation | MV-G1 |
| MV-G14 | ADR-0020 breaking-diff/side-by-side major CI gate. | L | new gate under `scripts/`, release-gates integration, contract snapshots | MV-G13 |
| MV-G15 | External baseline compatibility ranges. | M | `types.ts`, `versions.ts`, external surface manifests, validator | MV-G13 |
| MV-G16 | Decide exact pin vs range policy for baseline versions. | S | `versions.ts`, package generation tests | None |
| MV-G17 | Baseline override detection. | M | generated validator template, package-json helpers, integration tests | MV-G16 |
| MV-G18 | Validate external baseline compatibility. | M | ADR-0020 gate, external surface manifests | MV-G15, MV-G17 |
| MV-G19 | Platform Overlay contract distinct from CodeSmith overlays. | M | `types.ts`, topology/config generation, validator | MV-G1 |
| MV-G20 | Classify non-baseline central constants as defaults vs overlay policy. | S | `versions.ts`, docs, generator metadata | MV-G19 |
| MV-G21 | Overlay non-relaxation validation. | M | generated validator, release gates, tests | MV-G19 |
| MV-G22 | Mandatory degraded-state surface consumption API. | L | `packages/runtime/plugin-runtime/src/module-federation/**`, generated templates, plugin-bff adapters | MV-G25 |
| MV-G23 | Mandatory backend delivery-unit enforcement for public loaders. | M | `packages/cli/plugin-bff/src/runtime/effect/backend-federation/**`, tests | MV-G1 |
| MV-G24 | Resolver/rollback provider matrix with env and Zephyr/LKG providers. | L | `module-federation/**`, plugin-runtime resolver, backend manifest resolver, tests | MV-G25 |
| MV-G25 | Unified logical surface resolver seam. | L | new resolver module, `remote-refs.ts`, backend manifest adapter, generated configs | MV-G1 |
| MV-G26 | Optional Zephyr snapshot/tag resolver provider. | M | resolver provider, Zephyr config, production readiness tests | MV-G25 |
| MV-G27 | Foreign MF runtime acceptance tests. | M | integration tests, MF fixtures | MV-G25 |
| MV-G28 | Multi-shell model and generation. | L | `descriptors.ts`, `write-workspace.ts`, `add-vertical/**`, topology/overlays, tests | MV-G1 |
| MV-G29 | Shell delivery-unit identity stamping. | M | `contracts.ts`, `delivery-unit-sync.ts`, validator template | MV-G1, MV-G28 |
| MV-G30 | Shell-thinness lint/gate. | M | new/generated script gate, boundary guards, tests | MV-G28 |
| MV-G31 | Router provider scoping for independent vertical apps. | M | `packages/runtime/plugin-runtime/src/router/runtime/provider.ts`, `packages/runtime/plugin-tanstack/**`, tests | MV-G8 |
| MV-G32 | Script-family cleanup and semantic gate routing. | M | `package.json`, `scripts/release-gates/**`, CI workflows, docs | MV-G10, MV-G14, MV-G22 |

## Could Not Verify

- Live generator output was not created or executed for headless, separate-repo, full-mesh, external-surface, or multi-shell scenarios because this task was explicitly report-only.
- No `pnpm check`, `pnpm build`, integration tests, or browser smoke were run; production readiness behavior is cited from source and publish/Tractor workflow wiring only.
- No live Zephyr snapshot/tag behavior was verified; current evidence is generated env-manifest resolution code and retired ADR text (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts:26-58`, `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md:3`).
- No external repositories were available in this workspace to test separate-repo MicroVertical publishing or external consumer semver migration.
- The downstream Tractor demo was not checked because no UltraModern generator/runtime/tooling code was changed, and the user asked for report-only work.
