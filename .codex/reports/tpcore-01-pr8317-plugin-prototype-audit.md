# tpcore-01 PR #8317 Plugin Prototype Audit

Graph: `tanstack-plugin-first-class-ssr`
Plan: `tanstack-plugin-core-hooks.plan.md`
Todo: `tpcore-01`
Prototype branch: `refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class` at `32b44a7aa771402842bc72971eb1b8528ede1c26`

## Commands Used

```bash
python3 /Users/satan/side/experiments/skills/subagent-graph/scripts/get_agent_limits.py
git status --short
git branch --show-current
git remote -v
sed -n '1,240p' .codex/reports/tanstack-plugin-ssr-hooks-pr8317-20260514.md
sed -n '1,220p' .codex/plans/tanstack-plugin-core-hooks.plan.md
sed -n '1,220p' .codex/plans/tanstack-router-plugin-package.plan.md
sed -n '1,220p' .codex/plans/tanstack-plugin-ssr-mf-contract.plan.md
git fetch bleedingdev feat/tanstack-router-tailwind-first-class:refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class
git rev-parse refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class
git log -1 --oneline refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class
git ls-tree -r --name-only refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class -- packages/runtime/plugin-tanstack
gh pr view 8317 --repo web-infra-dev/modern.js --json title,state,author,body,comments,reviews --jq '{title,state,author:.author.login,body,comments:[.comments[]|{author:.author.login,body:.body}],reviews:[.reviews[]|{author:.author.login,state:.state,body:.body}]}'
git diff --find-renames --find-copies --stat HEAD..refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class -- packages/runtime/plugin-runtime/src/router/cli packages/runtime/plugin-runtime/src/router/runtime/tanstack packages/runtime/plugin-runtime/src/exports/tanstack-router.ts packages/runtime/plugin-tanstack
git diff --find-renames --find-copies HEAD..refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class -- packages/runtime/plugin-runtime/src/router/cli/index.ts packages/runtime/plugin-runtime/src/router/cli/handler.ts packages/runtime/plugin-runtime/src/router/cli/entry.ts packages/runtime/plugin-runtime/src/router/cli/code/index.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/package.json
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/cli/index.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/runtime/index.tsx
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/runtime/plugin.tsx
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/runtime/dataMutation.tsx
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/runtime/routeTree.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-runtime/src/router/cli/entry.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-runtime/src/router/cli/handler.ts
rg -n "modernRouteAction|@modern-js/runtime/tanstack-router|tanstackRouter|framework\s*:\s*['\"]tanstack|generateCode|handleGeneratorEntryCode|modifyEntrypoints|handleFileChange" packages/runtime/plugin-runtime/src packages/runtime/plugin-runtime/tests tests/integration/routes-tanstack* --glob '!tests/integration/routes-tanstack-mf/**'
git show HEAD:packages/runtime/plugin-runtime/src/router/cli/code/tanstackTypes.ts
git show HEAD:packages/runtime/plugin-runtime/src/router/runtime/hooks.ts
git show HEAD:packages/runtime/plugin-runtime/src/router/runtime/lifecycle.ts
git show HEAD:packages/runtime/plugin-runtime/src/router/runtime/types.ts
git show HEAD:packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx
git show HEAD:packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx
git diff --find-renames --find-copies HEAD..refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class -- packages/runtime/plugin-runtime/src/router/runtime/internal.ts packages/runtime/plugin-runtime/src/router/runtime/tanstack packages/runtime/plugin-runtime/src/exports/tanstack-router.ts packages/runtime/plugin-runtime/package.json
git grep -n "tanstackRouterPlugin\|@modern-js/plugin-tanstack\|runtime/tanstack\|router\.framework\|framework: 'tanstack'" refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class -- packages tests packages/toolkit
```

## PR Discussion Constraints

The maintainers want TanStack Router support, but not by adding TanStack packages directly to `@modern-js/runtime`. The accepted direction is:

- Add generic core extension points first.
- Put TanStack Router integration in `@modern-js/plugin-tanstack`.
- Let the plugin own entry-code generation through Modern.js CLI hooks.
- Add richer SSR runtime hooks separately, then put TanStack SSR on top of those hooks.

That means `tpcore-02` should not implement TanStack behavior in core. It should only make core extensible enough that `tplug-01..03` can move TanStack code out cleanly.

## What To Port

### Core CLI Extension Pieces

Port these ideas from `packages/runtime/plugin-runtime/src/router/cli/**` on the prototype branch:

- Route directory metadata in `entry.ts`: `ROUTES_DIR_META_KEY`, `getEntrypointRoutesDir`, `hasNestedRoutes(dir, routesDir)`, `isRouteEntry(dir, routesDir)`, and `modifyEntrypoints(entrypoints, routesDir)`.
- Built-in router filtering in `routerPlugin`: React Router should only generate/runtime-install for built-in route entries, not plugin-owned route entries.
- `handleGeneratorEntryCode(api, entrypoints, entrypointsKey)` returning `routesByEntry` from core route generation.
- `handleFileChange(api, event, { includeEntry, regenerate, entrypointsKey })` so plugin-owned route directories can regenerate without sharing the built-in router's cached entrypoint set.
- `generateCode(...)` returning generated routes by entry and no longer writing TanStack-specific files from core.
- Nested route spec JSON merge behavior in `onBeforeGenerateRoutes`, so multiple route plugins can contribute server route metadata without overwriting each other.

These are the reusable `tpcore-02` pieces. They should be ported with current branch style and tests, not by copying the prototype verbatim.

### Plugin Package Shape

The prototype `packages/runtime/plugin-tanstack/package.json` has the correct high-level package/export model:

- `@modern-js/plugin-tanstack` and `@modern-js/plugin-tanstack/cli` export the CLI plugin.
- `@modern-js/plugin-tanstack/runtime` exports TanStack runtime APIs and Modern wrappers.
- TanStack packages move from `@modern-js/runtime` dependencies into the plugin package.
- `@modern-js/runtime` becomes a peer/workspace dependency, not the owner of TanStack.

This is the right starting point for `tplug-01`, but versions must be reconciled with `main-ultramodern`. The prototype branch is from an older dependency baseline and should not bring its root `package.json` or `pnpm-lock.yaml` churn forward.

### Plugin CLI Shape

The prototype `packages/runtime/plugin-tanstack/src/cli/index.ts` is useful because it shows:

- `tanstackRouterPlugin(options)` as the app-facing config entry.
- Default `routesDir = 'views'` to avoid accidental activation of the built-in `routes` convention.
- Default `generatedDirName = 'modern-tanstack'`.
- Plugin runtime module constant `@modern-js/plugin-tanstack/runtime`.
- `_internalRuntimePlugins` insertion for `@{metaName}/plugin-tanstack/runtime`.
- Explicit `api.checkEntryPoint`, `api.modifyEntrypoints`, `api.generateEntryCode`, `api.onFileChanged`, `api.modifyFileSystemRoutes`, and `api.onBeforeGenerateRoutes` ownership.
- Plugin-owned `writeTanstackRegisterFile` and `writeTanstackRouterTypesForEntry`.

Port the shape, but use the current branch's action-aware generator logic.

### Runtime Helpers

The runtime files that should move to the plugin package are:

- `basepathRewrite.ts`
- `dataMutation.tsx`
- `prefetchLink.tsx`
- `routeTree.ts`
- client runtime plugin behavior from `plugin.tsx`
- public runtime barrel from `src/exports/tanstack-router.ts`

Use current `main-ultramodern` as the source of truth for these files, not the prototype versions. Current branch already has `modernRouteAction`, Router SSR hydration, router runtime state, and newer TanStack dependency versions.

## What To Reject Or Defer

- Reject wholesale cherry-pick of the branch. It downgrades package versions, rewrites `pnpm-lock.yaml`, and predates current `main-ultramodern` TanStack/SSR work.
- Reject removing current router lifecycle hooks from core. The prototype simplifies `router/runtime/internal.ts`, but current branch already has lifecycle surfaces needed for SSR and future plugin hooks.
- Reject the prototype `tanstackTypes.ts` as-is because it lacks the current `modernRouteAction` static-data bridge.
- Reject moving create scaffolds, Tailwind support, docs, and broad fixture churn as part of `tpcore-02`. Those belong after the package exists and passes core/plugin tests.
- Defer removing `@modern-js/runtime/tanstack-router` until `@modern-js/plugin-tanstack/runtime` is available and fixtures have moved. A temporary compatibility shim can be considered, but the primary path should become the plugin runtime export.
- Defer true TanStack SSR extraction until generic SSR runtime hooks are available. The prototype plugin package does not contain a server runtime plugin equivalent to current `plugin.node.tsx`; current SSR logic is richer and should be moved only after `tpcore-03`.
- Defer `routesDir: 'routes'` first-class support unless `tpcore-02` cleanly disables built-in React Router for plugin-owned entries. The prototype's default `views` is a pragmatic upstream-compatible default.

## Conflicts With Current Branch

- Current `@modern-js/runtime` still owns `@tanstack/react-router`, `@modern-js/runtime/tanstack-router`, `router.framework = 'tanstack'`, `plugin.node.tsx`, `plugin.tsx`, `routeTree`, `dataMutation`, and generated TanStack types.
- Current generated files import from `@modern-js/runtime/tanstack-router`; plugin output must import from `@modern-js/plugin-tanstack/runtime`.
- Current `tanstackTypes.ts` has `modernRouteAction` support. Prototype plugin generator does not; porting prototype generator would regress `useFetcher` and `Form` action handoff.
- Current SSR code uses `RouterClient`, `attachRouterServerSsrUtils`, server snapshots, matched route IDs, hydration script collection, and runtime state. Prototype extraction removes core TanStack SSR code but does not re-home an equivalent server-side plugin.
- Current fixtures and type tests under `tests/integration/routes-tanstack*` still use runtime-core imports/config. They must migrate in `tplug-04`, not in core hook work.
- The existing dirty `tests/integration/routes-tanstack-mf/**` patch should remain downstream. It demonstrates the SSR/MF seam but should not influence `tpcore-02` except as a later acceptance target.

## Package And Export Shape

Target package shape:

```json
{
  "name": "@modern-js/plugin-tanstack",
  "exports": {
    ".": { "types": "./dist/types/cli/index.d.ts", "node": { "import": "./dist/esm-node/cli/index.mjs", "require": "./dist/cjs/cli/index.js" }, "default": "./dist/cjs/cli/index.js" },
    "./cli": { "types": "./dist/types/cli/index.d.ts", "node": { "import": "./dist/esm-node/cli/index.mjs", "require": "./dist/cjs/cli/index.js" }, "default": "./dist/cjs/cli/index.js" },
    "./runtime": { "types": "./dist/types/runtime/index.d.ts", "default": "./dist/esm/runtime/index.mjs" },
    "./package.json": "./package.json"
  }
}
```

Runtime barrel should export:

- TanStack Router public APIs from `@tanstack/react-router`.
- Modern-compatible `Link`/`NavLink` prefetch wrappers.
- Modern-compatible `Form`, `useFetcher`, and action error types.
- `tanstackRouterPlugin` runtime plugin.
- Plugin hook types when they remain plugin-local.

CLI barrel should export:

- `tanstackRouterPlugin(options)`.
- `TanstackRouterPluginOptions`.
- Default export equal to `tanstackRouterPlugin`.

## Suggested Implementation Sequence

### `tpcore-02`: Generic Router CLI Hooks

1. Add route-directory metadata and parameterized route-entry helpers in core CLI.
2. Make `handleModifyEntrypoints`, `handleGeneratorEntryCode`, and `handleFileChange` accept plugin scoping options.
3. Make core `generateCode` return `routesByEntry` and remove direct TanStack file generation from that path.
4. Make built-in `routerPlugin` filter to built-in route entries only and merge nested-route spec JSON instead of overwriting it.
5. Add focused tests with a fake non-TanStack plugin/route directory proving plugin-owned entries can generate independently and do not install the built-in React Router runtime plugin.
6. Keep existing `framework: 'tanstack'` behavior temporarily if needed for compatibility, but mark it as transitional once `@modern-js/plugin-tanstack` is ready.

### `tplug-01`: Scaffold `@modern-js/plugin-tanstack`

1. Add `packages/runtime/plugin-tanstack` with package metadata, Rslib config, tsconfig, and test config based on the prototype package.
2. Use current branch dependency versions and workspace conventions.
3. Move or copy runtime helper tests for `dataMutation` and `routeTree` into the plugin package without changing fixture imports yet.
4. Add package build/type verification before touching app fixtures.

### `tplug-02`: Move Route Generation Into Plugin CLI

1. Move current action-aware `tanstackTypes.ts` into plugin CLI and parameterize `runtimeModule` as `@modern-js/plugin-tanstack/runtime`.
2. Implement `tanstackRouterPlugin` with plugin-owned `routesDir`, `generatedDirName`, route-spec merge, runtime plugin insertion, file-change regeneration, and register-file generation.
3. Update generated type tests to expect module augmentation for `@modern-js/plugin-tanstack/runtime`.
4. Preserve `modernRouteLoader` and `modernRouteAction` static-data handoff.

### `tplug-03`: Move Runtime APIs And Client Plugin

1. Move current runtime TanStack helpers to `packages/runtime/plugin-tanstack/src/runtime/**`.
2. Change generated and fixture imports to `@modern-js/plugin-tanstack/runtime`.
3. Add the plugin runtime to Modern app runtime plugins through CLI plugin injection, not `router.framework = 'tanstack'`.
4. Leave current server-side TanStack SSR behavior in place or behind a compatibility shim until `tpcore-03` provides generic SSR hooks.
5. After compatibility tests pass, remove primary TanStack exports/dependencies from `@modern-js/runtime`; keep a temporary shim only if needed for staged migration.

## Classification Summary

- Generic hook candidates: route directory metadata, scoped entry generation, scoped file-change regeneration, generated routes returned by entry, nested route spec merge, future SSR lifecycle hooks.
- Plugin-owned implementation: TanStack route generation, register file generation, runtime API barrel, client RouterProvider wiring, route tree conversion, prefetch links, `Form`/`useFetcher`, action/static-data bridge.
- Compatibility shim candidates: `@modern-js/runtime/tanstack-router`, `router.framework = 'tanstack'`, existing fixtures using runtime-core imports.
- Removable/deferred fixture code: Tailwind/create docs from PR #8317, broad `routes-tanstack-mf` SSR fixture patch, old prototype package version churn, prototype generator without `modernRouteAction`.
