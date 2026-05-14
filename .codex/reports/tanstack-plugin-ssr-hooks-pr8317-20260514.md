# TanStack Plugin + SSR Hooks Notes

Source: https://github.com/web-infra-dev/modern.js/pull/8317

## Upstream Direction

ByteDance maintainers do want TanStack Router support, but they do not want TanStack packages introduced directly into `@modern-js/runtime` because Modern.js is used by a large internal project base. The preferred shape is:

- core exposes router and SSR extension hooks;
- TanStack Router lives in `@modern-js/plugin-tanstack`;
- app config enables it with `tanstackRouterPlugin(...)`;
- CLI route entry generation is owned by the plugin through `generateEntryCode`;
- SSR runtime hooks should be added to core first, then TanStack SSR can plug into them.

The old PR branch already contains a useful prototype:

- `packages/runtime/plugin-tanstack`
- CLI plugin entry: `tanstackRouterPlugin(...)`
- runtime export: `@modern-js/plugin-tanstack/runtime`
- generated router imports from the plugin runtime instead of `@modern-js/runtime/tanstack-router`
- core router CLI helpers are generalized with custom route directories and regeneration hooks.

## Required Cleanup For Current Branch

- Stop growing TanStack behavior inside `@modern-js/runtime` unless it is an extension hook.
- Port the plugin extraction shape from the PR branch onto `main-ultramodern` deliberately, not by cherry-picking the whole branch.
- Keep the existing `modernRouteAction` generator bridge, but move plugin-owned generated output toward `@modern-js/plugin-tanstack/runtime`.
- Keep SSR hook work separate from fixture work. The fixture should prove the seam; core should provide a hook/boundary that a plugin can use.
- The current `routes-tanstack-mf` dirty patch is not ready to land until it is cleaned into a minimal plugin-compatible contract and verified.

## SSR Hook Seam

The current fixture can express shell SSR, but remote component SSR remains blocked on a runtime extension point. The seam should let a plugin:

- load/resolve server-capable MF remote modules before shell HTML render;
- render remote React components during server string/stream rendering;
- collect remote preload/hydration metadata;
- choose deterministic fallback when a remote cannot be loaded or is incompatible;
- preserve TanStack route loader/action static-data handoff.

## Open Beads

- `modernjs-wrf`: extract TanStack Router into a plugin package.
- `modernjs-vq0`: clean up the current TanStack MF SSR fixture seam patch.
