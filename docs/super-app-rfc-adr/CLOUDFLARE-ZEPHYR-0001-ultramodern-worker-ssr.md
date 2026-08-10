# UltraModern Cloudflare Worker SSR and Zephyr Evidence

## Status

Implemented for local Cloudflare Worker validation and generated public URL
proof commands. Live Cloudflare and Zephyr proof still requires public Worker
URLs and Zephyr credentials.

## Supported Build Profile

Full-stack UltraModern verticals use normal Modern.js build primitives:

- `deploy.target: 'cloudflare'`
- `deploy.worker.ssr: true`
- stream SSR with `moduleFederationAppSSR: true`
- `@modern-js/plugin-bff/effect-edge` for package-owned Effect BFF handlers
- mandatory `@modern-js/plugin-i18n` runtime config with `en` and `cs` resources
- Module Federation exposes for browser-safe UI modules only

The current Tractor reference workspace applies this profile to:

| App | Cloudflare proof env | Effect readiness |
| --- | --- | --- |
| `shell-super-app` | `ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP` | none |
| `remote-explore` | `ULTRAMODERN_PUBLIC_URL_REMOTE_EXPLORE` | `/explore-api/explore/readiness` |
| `remote-decide` | `ULTRAMODERN_PUBLIC_URL_REMOTE_DECIDE` | `/decide-api/decide/readiness` |
| `remote-checkout` | `ULTRAMODERN_PUBLIC_URL_REMOTE_CHECKOUT` | `/checkout-api/checkout/readiness` |

Each remote is a single deployable ownership boundary for UI, MF manifest,
API, locale JSON, CSS, and build marker. Public proof must compare those
surfaces for the same selected build.

The generated package scripts are:

```bash
pnpm cloudflare:build
pnpm --filter "./apps/remotes/**" run cloudflare:build
pnpm --filter "./apps/remotes/remote-explore" run cloudflare:preview
```

The workspace pins Node `>=26` and `packageManager: pnpm@11.21.0`, writes `.mise.toml` with pnpm `11.21.0`, and records mise as the toolchain in `.modernjs/ultramodern-generated-contract.json`.

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
```

> **Note (2026-06-12):** the repo-local no-deploy Worker + ASSETS-emulation
> validator (`scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js`)
> was removed in the fork cleanup. Evidence collection now goes through the
> generated workspace's own proof scripts
> (`scripts/ultramodern-cloudflare-proof.mjs` and
> `scripts/proof-cloudflare-version.mjs`, exposed as `pnpm cloudflare:proof`),
> as exercised by `scripts/ultramodern-production-readiness/run-published-create-proof.mjs`.

`MODERN_PUBLIC_SITE_URL` in this validation path is canonical/SEO-only. JS,
CSS, and static assets use `MODERN_ASSET_PREFIX`, then
`ULTRAMODERN_ASSET_PREFIX`, then the origin-relative `/` fallback.

The local evidence bundle proves:

- `/en` and `/cs` return translated SSR HTML.
- `/locales/en/<namespace>.json` resolves from bound assets.
- `/mf-manifest.json` resolves from the same Worker.
- the app-owned Effect readiness route returns BFF JSON.
- UI and BFF markers share the same build identity.

For generated workspaces, the workspace-owned proof covers each app's
readiness route, SSR HTML, MF manifest, locale JSON, and build markers via
`pnpm cloudflare:proof` (see note above).

After deploying public Workers, run the generated public URL proof:

```bash
ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://shell-super-app.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_EXPLORE=https://remote-explore.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_DECIDE=https://remote-decide.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_CHECKOUT=https://remote-checkout.example.workers.dev \
pnpm cloudflare:proof --require-public-urls
```

The generated proof reads `.modernjs/ultramodern-generated-contract.json` and
asserts SSR HTML, MF manifest, locale JSON, CSS root marker, and API
marker. It records skipped apps when public URL env vars are absent unless
`--require-public-urls` is set.

## Zephyr

Modern.js still uses `zephyr-rspack-plugin` for Module Federation/client asset snapshots during normal builds. The Cloudflare SSR upload helper is `scripts/ultramodern-zephyr-ssr-upload/upload-zephyr-ssr.js`; it validates `.output/server/index.mjs` and `wrangler.json`, then calls `zephyr-agent` with `ssr: true`, `builder: 'modern-js'`, and `target: 'cloudflare'`.

Legacy local proof uploaded fresh Zephyr snapshots for the earlier
`remote-commerce` boundary while building the Cloudflare output, including:

- client: `https://syreanis-gmail-com-1165-ultra-workspace-remote-co-14a312945-ze.zephyrcloud.app`
- server: `https://syreanis-gmail-com-1166-ultra-workspace-remote-co-4ccdc5235-ze.zephyrcloud.app`
- workerSSR: `https://syreanis-gmail-com-1167-ultra-workspace-remote-co-411310034-ze.zephyrcloud.app`

These URLs prove Zephyr upload/auth integration for that generated boundary.
They do not prove the current Tractor Explore/Decide/Checkout live full-stack
version switching claim.

> **Removed (2026-06-12):** the Tractor live-evidence harness
> (`scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js`) was
> deleted in the fork cleanup — it hardcoded the retired Tractor
> Explore/Decide/Checkout topology. Live version-switching evidence for current
> workspaces must come from the workspace-owned proof scripts plus a manual or
> future harness; the upload-side helper (`scripts/ultramodern-zephyr-ssr-upload`)
> is retained and remains the supported tool.

## Remaining Live Proof

`modernjs-hjgv` must prove the product-level claim:

1. Publish v1 and v2 of a vertical where UI marker and Effect BFF marker both change.
2. Configure the shell through Zephyr dependency/version/environment selection.
3. Assert the rendered shell UI marker and fetched BFF marker move together.
4. Capture the operational switching mechanism, whether Zephyr GUI, browser extension, environment override, or a supported CLI/API path.

Until that proof lands with public URLs and credentials, Cloudflare Worker
SSR/BFF is validated locally and Zephyr upload can be validated, but live
runtime version switching is not closed.
