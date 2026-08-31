# Patch Ledger

This directory contains pnpm patches for external packages. These are not forked
source files; the monorepo applies them through `pnpm-workspace.yaml`.

## Patch Split

Repo-only patches are used by the Modern.js monorepo build and are not copied
into generated UltraModern workspaces:

- `@module-federation/manifest@2.9.0` -> `patches/@module-federation__manifest@2.9.0.patch`
- `@module-federation/rspack@2.9.0` -> `patches/@module-federation__rspack@2.9.0.patch`

Shared patches exist in both this directory and
`packages/toolkit/ultramodern-create/template-workspace/patches/`. They must stay
byte-identical because generated workspaces rely on the template copy at
runtime:

- `@module-federation/bridge-react@2.9.0` -> `@module-federation__bridge-react@2.9.0.patch`
- `@module-federation/dts-plugin@2.9.0` -> `@module-federation__dts-plugin@2.9.0.patch`
- `@module-federation/modern-js-v3@2.9.0` -> `@module-federation__modern-js-v3@2.9.0.patch`
- `@module-federation/runtime-core@2.9.0` -> `@module-federation__runtime-core@2.9.0.patch`
- `@tanstack/router-core@1.171.27` -> `@tanstack__router-core@1.171.27.patch`

The shared list is defined in
`packages/toolkit/ultramodern-create/src/ultramodern-workspace/shared-patches.ts` and gated
by `packages/toolkit/ultramodern-create/tests/patch-sync.test.ts`.

Template-only patches live only under
`packages/toolkit/ultramodern-create/template-workspace/patches/` and are used by generated
workspaces:

- `drizzle-orm-ts7-strict-declarations.patch`

## What Patches Do

- `@module-federation/manifest`: avoids loading `@module-federation/dts-plugin/core` at module import time and returns default type metadata immediately when `dts: false`.
- `@module-federation/dts-plugin`: preserves the effective absolute `rootDir` in the temporary TS-Go `--listFilesOnly` config so declarations imported by an exposed module are collected instead of falling back to exposed files only.
- `@module-federation/modern-js-v3`: suppresses the stream SSR splitChunks warning when `splitChunks.chunks` is already `async`, while still coercing invalid values to `async`; preserves configured lazy compilation for remote-only consumers while retaining the upstream producer safeguard; injects the Modern.js manifest-recovery runtime plugin into server builds, resolving it from the application workspace; and keeps React bridge CSS ownership in Modern.js by creating both bridge adapters with `injectLink: false`.
- `@module-federation/rspack`: avoids loading `@module-federation/dts-plugin` at module import time and only requires `DtsPlugin` when DTS generation is enabled.
- `@module-federation/bridge-react`: repairs non-portable declaration specifiers that reference package-local `node_modules/@types/react*` paths.
- `@module-federation/runtime-core`: imports `ResourceLoadContext` in the remote declaration that exposes it through the public `loadEntry` hook.
- `@tanstack/router-core`: repairs the invalid `MakeRouteMatch['__beforeLoadContext']` SSR declaration reference under strict library checking.
- `react-server-dom-rspack` 0.1.0 includes the official React Flight decoder
  security fixes that the repository previously backported onto 0.0.3. The
  root framework regression tests continue to verify those fixes while RSC
  stays disabled in the UltraModern company distribution.

These patches keep Module Federation usable in the fork's TS 7 native-preview
lane where apps use `dts: false`, while preserving DTS behavior for callers
that explicitly enable it and retaining their transitive public declarations.

## Sync Rules

1. Keep root `pnpm-workspace.yaml` `patchedDependencies` entries in sync with
   repo patch filenames.
2. Keep generated UltraModern workspace template `patchedDependencies` entries
   in sync with template patch filenames.
3. For every shared patch, copy the exact same patch bytes into both patch
   directories and update `SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES` if the
   shared set changes.
4. If Module Federation publishes the lazy-DTS fix upstream, remove the matching
   patch and regenerate the lockfile in the same change.
5. Remove the runtime-core patch and regenerate the lockfile once a Module
   Federation release imports `ResourceLoadContext` in `src/remote/index.ts`.
6. If a Module Federation package version changes but the same patch still
   applies, update `patchedDependencies`, patch filenames, the shared-patch
   constant, and the lockfile together.
7. Do not add app-level shims or local config suppressions to hide Module
   Federation DTS loading failures.
