# UltraModern Cloudflare Worker SSR and Zephyr Evidence

## Status

Implemented for local Cloudflare Worker validation. Live Zephyr version switching remains owned by `modernjs-hjgv`.

## Supported Build Profile

Full-stack UltraModern verticals use normal Modern.js build primitives:

- `deploy.target: 'cloudflare'`
- `deploy.worker.ssr: true`
- stream SSR with `moduleFederationAppSSR: true`
- `@modern-js/plugin-bff/effect-edge` for package-owned Effect BFF handlers
- mandatory `@modern-js/plugin-i18n` runtime config with `en` and `cs` resources
- Module Federation exposes for browser-safe UI modules only

The generated package scripts are:

```bash
pnpm cloudflare:build
pnpm --filter "./apps/remotes/**" run cloudflare:build
pnpm --filter "./apps/remotes/remote-commerce" run cloudflare:preview
```

No corepack source of truth is generated. The workspace pins `packageManager: pnpm@11.4.0`, writes `.mise.toml` with pnpm `11.4.0`, and records the toolchain policy as mise in `.modernjs/ultramodern-generated-contract.json`.

## Worker Output Contract

`MODERNJS_DEPLOY=cloudflare modern deploy` writes:

- `.output/server/index.mjs`: Cloudflare module Worker entry with `fetch`
- `.output/server/modern-worker-manifest.json`: route, asset, worker bundle, and BFF metadata
- `.output/server/route.json`: Modern route metadata copy
- `.output/public`: Wrangler ASSETS directory
- `.output/worker/index.js`: SSR request handler bundle
- `.output/worker/__modern_bff_effect.js`: Effect BFF worker bundle
- `.output/wrangler.json`: local/deploy Wrangler config

The Worker dispatch order is Effect BFF first, then SSR routes, then bound static assets.

## Validation

Local validation must run through Wrangler, not a static file server:

```bash
MODERN_PUBLIC_SITE_URL=https://ultramodern.example.test pnpm --dir <vertical> run cloudflare:build
pnpm --dir <vertical> exec wrangler dev --config .output/wrangler.json --port 8787
node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir <vertical> \
  --expect-en "Commerce Remote" \
  --expect-cs "Obchodni remote" \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/generated-remote-commerce-local-validation-20260527.json
```

The current evidence bundle is `.codex/reports/cloudflare-ssr/generated-remote-commerce-local-validation-20260527.json`. It proves:

- `/en` and `/cs` return translated SSR HTML.
- `/locales/en/translation.json` resolves from bound assets.
- `/mf-manifest.json` resolves from the same Worker.
- `/commerce-api/effect/recommendations` returns Effect BFF JSON.
- UI and BFF markers share the same build identity.

## Zephyr

Modern.js still uses `zephyr-rspack-plugin` for Module Federation/client asset snapshots during normal builds. The Cloudflare SSR upload helper is `scripts/ultramodern-zephyr-ssr-upload/upload-zephyr-ssr.js`; it validates `.output/server/index.mjs` and `wrangler.json`, then calls `zephyr-agent` with `ssr: true`, `builder: 'modern-js'`, and `target: 'cloudflare'`.

The latest local proof uploaded fresh Zephyr snapshots for `remote-commerce` while building the Cloudflare output, including:

- client: `https://syreanis-gmail-com-1165-ultra-workspace-remote-co-14a312945-ze.zephyrcloud.app`
- server: `https://syreanis-gmail-com-1166-ultra-workspace-remote-co-4ccdc5235-ze.zephyrcloud.app`
- workerSSR: `https://syreanis-gmail-com-1167-ultra-workspace-remote-co-411310034-ze.zephyrcloud.app`

These URLs prove Zephyr upload/auth integration for the generated vertical. They do not yet prove shell-driven live full-stack version switching.

## Remaining Live Proof

`modernjs-hjgv` must prove the product-level claim:

1. Publish v1 and v2 of a vertical where UI marker and Effect BFF marker both change.
2. Configure the shell through Zephyr dependency/version/environment selection.
3. Assert the rendered shell UI marker and fetched BFF marker move together.
4. Capture the operational switching mechanism, whether Zephyr GUI, browser extension, environment override, or a supported CLI/API path.

Until that proof lands, Cloudflare Worker SSR/BFF is validated locally and Zephyr upload is validated, but live runtime version switching is not closed.
