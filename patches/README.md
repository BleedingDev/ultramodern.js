# Patch Ledger

This directory contains pnpm patches for external packages. These are not fork source files; they are install-time patches applied by `pnpm-workspace.yaml`.

## Module Federation 2.5.1 patches

`pnpm-workspace.yaml` currently applies:

- `@module-federation/manifest@2.5.1` -> `patches/@module-federation__manifest@2.5.0.patch`
- `@module-federation/rspack@2.5.1` -> `patches/@module-federation__rspack@2.5.0.patch`

The filenames still say `2.5.0` because the patch bodies were created on the previous 2.5.0 package contents and still apply cleanly to the 2.5.1 cohort. The lockfile records the active 2.5.1 patch hashes, so the source of truth is the `patchedDependencies` key plus `pnpm-lock.yaml`, not the filename suffix.

## What the patches do

- `@module-federation/manifest`: avoids loading `@module-federation/dts-plugin/core` at module import time and returns default type metadata immediately when `dts: false`.
- `@module-federation/rspack`: avoids loading `@module-federation/dts-plugin` at module import time and only requires `DtsPlugin` when DTS generation is enabled.

This keeps Module Federation usable in the fork's TS 7 native-preview lane where many apps use `dts: false`, while preserving DTS behavior for callers that explicitly enable it.

## Sync rules

1. Keep both patches together with the root `patchedDependencies` entries.
2. If Module Federation publishes the lazy-DTS fix upstream, remove the matching patch and regenerate the lockfile in the same change.
3. If the package version changes and the same patch still applies, update `patchedDependencies` and lockfile first; rename patch files only when doing so reduces confusion in the same commit.
4. Do not add app-level shims or local config suppressions to hide Module Federation DTS loading failures.
