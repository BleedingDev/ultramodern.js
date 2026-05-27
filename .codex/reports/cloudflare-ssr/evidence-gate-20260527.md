# Cloudflare SSR Evidence Gate - 2026-05-27

Graph: `ultramodern-cloudflare-ssr-00-evidence-contract-plus-7-plans-21b4ea7f53`

## Package Baseline

| Package | Current latest | Implementation note |
| --- | ---: | --- |
| `zephyr-agent` | `1.1.1` | Source of truth for generic SSR snapshot upload. |
| `zephyr-rspack-plugin` | `1.1.1` | Keep for MF/client asset resolution; it is not an SSR snapshot deploy path by itself. |
| `vite-plugin-tanstack-start-zephyr` | `1.1.1` | TanStack-specific reference; do not depend on its output assumptions. |
| `@cloudflare/vite-plugin` | `1.39.0` | Vite-specific; useful as reference, not required by Modern/Rspack. |
| `wrangler` | `4.95.0` | Requires Node `>=22.0.0`; repo currently supports Node 20 in some contexts, so Worker preview tooling needs an engine decision. |
| `@tanstack/react-start` | `1.168.14` | Requires Node `>=22.12.0`; reference only. |
| `@module-federation/modern-js-v3` | `2.5.0` | Current latest; peer range still lists TypeScript 4/5, so watch TS 6 peer warnings. |
| `typescript` | `6.0.3` | Current stable. |
| `@typescript/native-preview` | `7.0.0-dev.20260526.1` | Repo pins `7.0.0-dev.20260525.1`; stale by one daily build. |

## Modern Worker SSR

Modern already has a partial Worker SSR build path:

- `deploy.worker.ssr` is typed in app-tools deploy config.
- `isServiceWorker` turns it on only for SSR/SSG apps.
- `getBuilderEnvironments` creates `workerSSR` with `target: 'web-worker'`.
- SSR CLI defines `MODERN_SSR_ENV=edge`, which selects the worker stream renderer.
- Generated server entries export Web `Request -> Response` `requestHandler`.
- `route.json` includes `route.worker = "worker/<entry>.js"` when worker SSR is enabled.

Main gaps:

- Current deploy entries use Node `createProdServer().listen()`.
- Node resource loading consumes `route.bundle`, not `route.worker`.
- Worker bundles currently default to `commonjs2`; Cloudflare module workers need an explicit module/import strategy.

## Effect BFF Edge Contract

The Effect BFF handler body is already Web-shaped, but the current public runtime entry is not Worker-clean:

- Best direct dispatcher path is existing `handler`, default factory, `createHandler({ openapi, dataPlatform })`, then `{ api, layer }`.
- `EffectAdapter` discovery, filesystem loading, middleware mounting, and prefix wiring are Node/control-plane pieces.
- `@modern-js/plugin-bff/effect-server` re-exports context that imports `node:async_hooks`.
- `useEffectContext` is Node-backed today and needs an edge-safe equivalent or an explicit unsupported boundary.

Plan 02 must provide an edge-safe export or dispatcher before the deploy Worker can call package-owned Effect routes safely.

## Zephyr SSR Snapshot

`zephyr-agent@1.1.1` is the contract to target:

```ts
uploadOutputToZephyr({
  rootDir,
  outputDir,
  publicDir,
  baseURL,
  builder,
  target,
  ssr: true,
  hooks,
})
```

Entrypoint detection is strict:

- `server/index.js`
- `server/index.mjs`
- `server/server.js`
- `server/server.mjs`
- `server/_worker.js`
- `server/_worker.mjs`
- `index.mjs`
- `index.js`

When `ssr` is true, Zephyr uploads `snapshotType: 'ssr'` and the entrypoint. SSR Worker support is beta and currently Cloudflare-managed.

## Cloudflare Reference

TanStack Start proves the shape, not the exact Modern implementation:

- Worker artifact must export `fetch(request, env, ctx)` and return Web `Response`.
- Wrangler `main` must point to a built Modern Worker artifact.
- Static asset config must use Modern output paths.
- If code calls `env.ASSETS.fetch`, the generated Wrangler config must include an `ASSETS` binding.
- Do not bake in Vite-only `viteEnvironment: { name: 'ssr' }` assumptions.

## Validation Contract

Local proof must run through one Worker process, not static serving plus a separate API process:

- `/en` SSR English.
- `/cs` SSR Czech.
- locale JSON assets.
- `mf-manifest.json`.
- referenced JS/CSS/static assets.
- package-owned Effect endpoint, such as `/commerce-api/effect/recommendations`.
- UI marker and BFF marker must match the same package/version/build identity.

Live Zephyr proof must add:

- app UID, snapshot ID, `snapshotType: 'ssr'`, entrypoint, deployment URL, manifest URL.
- selected remote version/tag/exact/environment selector.
- matching shell-rendered UI marker and BFF marker.
- negative skew control that fails with a full-stack version mismatch.
