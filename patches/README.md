# Patch Ledger

This directory contains pnpm patches for external packages. These are not forked
source files; the monorepo applies them through `pnpm-workspace.yaml`.

## Patch Split

Repo-only patches are used by the Modern.js monorepo build and are not copied
into generated UltraModern workspaces:

- `@module-federation/manifest@2.8.2` -> `patches/@module-federation__manifest@2.8.2.patch`
- `@module-federation/rspack@2.8.2` -> `patches/@module-federation__rspack@2.8.2.patch`
- `react-server-dom-rspack@0.0.3` -> `patches/@react-server-dom-rspack@0.0.3.patch` (root-only RSC regression-test containment)

Shared patches exist in both this directory and
`packages/toolkit/create/template-workspace/patches/`. They must stay
byte-identical because generated workspaces rely on the template copy at
runtime:

- `@module-federation/bridge-react@2.8.2` -> `@module-federation__bridge-react@2.8.2.patch`
- `@module-federation/modern-js-v3@2.8.2` -> `@module-federation__modern-js-v3@2.8.2.patch`

The shared list is defined in
`packages/toolkit/create/src/ultramodern-workspace/shared-patches.ts` and gated
by `packages/toolkit/create/tests/patch-sync.test.ts`.

Template-only patches live only under
`packages/toolkit/create/template-workspace/patches/` and are used by generated
workspaces:

- `drizzle-orm-ts7-strict-declarations.patch`
- `effect-schema-error-type-id.patch`

## What Patches Do

- `@module-federation/manifest`: avoids loading `@module-federation/dts-plugin/core` at module import time and returns default type metadata immediately when `dts: false`.
- `@module-federation/modern-js-v3`: suppresses the stream SSR splitChunks warning when `splitChunks.chunks` is already `async`, while still coercing invalid values to `async`; disables lazy compilation for both remote producers and consumers; and injects the Modern.js manifest-recovery runtime plugin into server builds, resolving it from the application workspace.
- `@module-federation/rspack`: avoids loading `@module-federation/dts-plugin` at module import time and only requires `DtsPlugin` when DTS generation is enabled.
- `@module-federation/bridge-react`: repairs non-portable declaration specifiers that reference package-local `node_modules/@types/react*` paths.
- `effect-schema-error-type-id.patch`: replaces beta.107's dangling public `SchemaAST.Sentinel` declaration reference with `unknown`; no private Effect HTTP declarations are patched.
- `react-server-dom-rspack`: backports the official React Flight decoder security fixes missing from the newest upstream Rspack package across all shipped server bundles. The patched package is used only by root framework RSC regression tests while RSC stays disabled in the UltraModern company distribution. It is not published, copied into generated workspaces, or imposed on application consumers.

These patches keep Module Federation usable in the fork's TS 7 native-preview
lane where apps use `dts: false`, while preserving DTS behavior for callers
that explicitly enable it.

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
5. If a Module Federation package version changes but the same patch still
   applies, update `patchedDependencies`, patch filenames, the shared-patch
   constant, and the lockfile together.
6. Do not add app-level shims or local config suppressions to hide Module
   Federation DTS loading failures.
