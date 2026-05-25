---
name: Ultramodern Full Stack MicroVertical
overview: Pivot Ultramodern generated verticals from split FE remote plus separate services into one package that owns Module Federation exposes, Effect/BFF handlers, vertical contracts, Zephyr dependencies, build scripts, and topology as a single version boundary.
todos:
  - id: map-current-split-architecture
    content: "Map the current generated remote app, Effect service, shared-effect-api package, topology, add-flow, tests, README, and validator paths that encode split vertical behavior."
    status: completed
  - id: define-full-stack-package-contract
    content: "Define the generated package contract for a vertical package including FE exposes, api/effect handlers, vertical-owned contract/client exports, BFF config, MF config, Zephyr dependency map, scripts, ports, and topology entry."
    status: completed
  - id: refactor-generator-model
    content: "Refactor ultramodern-workspace.ts data structures so verticals can carry frontend, server, Effect API, and Zephyr metadata in one WorkspaceApp-like model without losing shell and design-system semantics."
    status: completed
  - id: generate-full-stack-package-files
    content: "Generate api/effect, src client helpers, vertical contract files, package.json dependencies, modern.config.ts plugins, module-federation.config.ts exposes, route/widget files, and dev/build scripts inside each vertical package."
    status: completed
  - id: migrate-topology-and-overlays
    content: "Update reference topology and development overlays so vertical entries advertise both MF manifest metadata and owned BFF/API prefixes instead of separate effectServices for vertical-owned APIs."
    status: completed
  - id: update-add-microvertical-flow
    content: "Change add-ultramodern microvertical creation so vertical is the default full-stack package path and service-only creation is either removed or explicitly renamed external-service."
    status: completed
  - id: update-docs-validator-and-tests
    content: "Update generated README, workspace validator, integration tests, and docs so they require one-package vertical behavior and reject accidental services/* default vertical scaffolding."
    status: completed
  - id: run-full-stack-generator-gates
    content: "Run focused create-ultramodern-workspace tests, generated workspace validation, typecheck, build, and assert-mf-types for shell plus vertical packages."
    status: completed
isProject: true
---

# Ultramodern Full Stack MicroVertical

## Execution Notes

Source Bead: `modernjs-y1fc`.

This is the core implementation plan. It should start after `Ultramodern React DOM Client Shared Singleton` and `Ultramodern Zephyr Profile Alignment` have landed or have explicit decisions, because the full-stack package generator needs the final shared config and Zephyr plugin profile.

Current split architecture evidence:

- FE remotes are defined as `remoteApps` in `packages/toolkit/create/src/ultramodern-workspace.ts:162`.
- The default Effect service is a separate object under `services/service-recommendations-effect` in `packages/toolkit/create/src/ultramodern-workspace.ts:255`.
- App dependencies add `@modern-js/plugin-bff` and `shared-effect-api` only for the shell, not for remotes: `packages/toolkit/create/src/ultramodern-workspace.ts:651`.
- Root `dev` runs shell plus FE remotes; `dev:recommendations` is separate: `packages/toolkit/create/src/ultramodern-workspace.ts:730`.
- Root `build` currently builds `./apps/remotes/**`, then shell, then MF type assertions, but not `services/*`: `packages/toolkit/create/src/ultramodern-workspace.ts:754`.
- `createAppPackage` assigns remote packages role `module-federation-remote` and adds `zephyr:dependencies`: `packages/toolkit/create/src/ultramodern-workspace.ts:879`.
- `createServicePackage` creates a separate `effect-service` role with BFF dependencies but no MF or Zephyr dependency metadata: `packages/toolkit/create/src/ultramodern-workspace.ts:909`.
- App Modern config enables TanStack, i18n, Module Federation, Zephyr, and MF SSR: `packages/toolkit/create/src/ultramodern-workspace.ts:1002`.
- Service Modern config enables BFF Effect runtime separately: `packages/toolkit/create/src/ultramodern-workspace.ts:1221`.
- Shared Effect contracts are centralized in `packages/shared-effect-api`: `packages/toolkit/create/src/ultramodern-workspace.ts:1661`.
- Effect service implementation imports the shared API package: `packages/toolkit/create/src/ultramodern-workspace.ts:1766`.
- Topology separates `remotes` from `effectServices`: `packages/toolkit/create/src/ultramodern-workspace.ts:1949`.
- The add-service integration test asserts `services/service-catalog-api-effect/*`, confirming current default service split: `tests/integration/create-ultramodern-workspace/tests/index.test.ts:963`.

Target package contract:

- A vertical package must be a Modern.js app and a Module Federation remote.
- The same package must include its owned `api/effect/index.ts` BFF handlers.
- The same package must include or export vertical-owned API contract/client code. Shared platform primitives may remain in shared packages, but vertical API contracts should not be centralized in `shared-effect-api` if the vertical is independently versioned.
- `modern.config.ts` must compose the selected Zephyr plugin profile, `moduleFederationPlugin()`, and `bffPlugin()` in a supported order.
- `server.ssr.moduleFederationAppSSR: true` remains required.
- The package `build` script must produce MF artifacts, BFF/server artifacts, and DTS; it must run `assert-mf-types`.
- The shell `zephyr:dependencies` must point at full-stack vertical packages, not separate FE-only remotes.
- A vertical may have its own `zephyr:dependencies` when it consumes other remotes.
- No server-only Effect handler implementation should be exposed to browser MF consumers. Browser-safe exports and server entrypoints must be separate.

External API and runtime evidence:

- Module Federation Node docs state Node.js consumers can load remote modules via `@module-federation/runtime`, and bundler integration uses `target: 'async-node'`, `remoteType: 'script'`, and commonjs remote entries.
- Modern.js local runtime already switches Node SSR output when `moduleFederationAppSSR` is true: `packages/runtime/plugin-runtime/src/cli/ssr/index.ts:247`.
- Modern.js tests verify this contract: `packages/runtime/plugin-runtime/tests/ssr/moduleFederation.test.ts:299`.
- Zephyr remote dependencies use `zephyr:dependencies` in `package.json`, mapping local MF aliases to application UIDs and selectors.
- Zephyr workspace resolution supports `workspace:*` with branch, platform, CI, and username build context.
- Zephyr environment overrides can change remote dependency version/tag/environment at runtime without rebuilding the host.

## Constraints

- Do not implement this as one physical package with two independent Zephyr apps unless Zephyr provides a release-group primitive that makes them switch atomically. The stated goal is one version boundary.
- Do not put server-only Effect handlers into browser-exposed MF modules.
- Do not keep vertical-owned API contracts solely in `packages/shared-effect-api`; that recreates central coupling and weakens independent versioning.
- Do not remove shared platform packages such as design tokens or cross-cutting primitives just to satisfy the one-package goal.
- Keep service-only packages only if they are explicitly external services, not the default micro-vertical model.
- Keep Cloudflare/Zephyr deployment support but avoid Cloudflare-only application logic because Zerops long-running Node support is a future target.

## Operator Guidance

Do this as a generator contract change, not a one-off fixture edit. Start with tests that fail for the desired package shape:

- generated default workspace contains `apps/remotes/remote-commerce/api/effect/index.ts` or the chosen vertical path equivalent.
- generated default workspace does not create `services/service-recommendations-effect` for vertical-owned recommendations capability.
- generated vertical package includes both `module-federation.config.ts` and BFF Effect config.
- topology has a single vertical entry with both MF and API metadata.
- shell dependency map points to full-stack vertical packages using `@workspace:*`.
- generated validation rejects a split vertical service when the vertical is supposed to be one package.

Suggested focused verification:

```bash
pnpm --filter @modern-js/create tests -- tests/integration/create-ultramodern-workspace/tests/index.test.ts
pnpm --dir <generated-workspace> ultramodern:check
pnpm --dir <generated-workspace> build
```

If the generated workspace build cannot run without Zephyr credentials, the default build must still support a local/no-auth path and the live Zephyr proof must be handled by the downstream proof plan.
