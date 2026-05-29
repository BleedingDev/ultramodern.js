# UltraModern Cloudflare SSR Validation

Validates a Modern Cloudflare `.output` artifact without Zephyr credentials.
Use it for generated Tractor shell and Explore/Decide/Checkout remotes after
`MODERNJS_DEPLOY=cloudflare modern build && MODERNJS_DEPLOY=cloudflare modern deploy`.

```bash
node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir apps/remotes/remote-explore \
  --bff /explore-api/effect/explore/readiness \
  --expect-en "Explore Remote" \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/remote-explore-local-validation.json
```

For deployed Workers, use `--public-url https://...workers.dev` and the same
route/marker options. Public URL mode skips local `.output` file checks and
records HTTP evidence from the live Cloudflare origin.

The script checks the Worker entry, Wrangler ASSETS binding, MF manifest, locale
asset, optional Effect BFF worker bundle, SSR route responses, BFF JSON response,
and UI/API build-marker lockstep.

## Tractor Route Examples

Each generated vertical owns its Effect readiness route:

```bash
node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir apps/remotes/remote-explore \
  --bff /explore-api/effect/explore/readiness \
  --expect-en "Explore Remote" \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/remote-explore-local.json

node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir apps/remotes/remote-decide \
  --bff /decide-api/effect/decide/readiness \
  --expect-en "Decide Remote" \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/remote-decide-local.json

node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir apps/remotes/remote-checkout \
  --bff /checkout-api/effect/checkout/readiness \
  --expect-en "Checkout Remote" \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/remote-checkout-local.json
```

Use route overrides when validating localized or nested route-owned URLs:

```bash
node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir apps/remotes/remote-checkout \
  --en /en/checkout/thank-you/order-123 \
  --cs /cs/pokladna/dekujeme/order-123 \
  --locale /locales/en/checkout.json \
  --bff /checkout-api/effect/checkout/readiness \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/remote-checkout-thanks-local.json
```

## Public URL Proof Boundary

The generated workspace also includes `scripts/proof-cloudflare-version.mjs`.
That proof reads `.modernjs/ultramodern-generated-contract.json`, fetches each
configured public URL, and checks SSR, MF manifest, locale JSON, CSS root
marker, and Effect readiness marker:

```bash
ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://shell-super-app.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_EXPLORE=https://remote-explore.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_DECIDE=https://remote-decide.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_CHECKOUT=https://remote-checkout.example.workers.dev \
pnpm cloudflare:proof -- --require-public-urls
```

Local `.output` validation proves the Worker artifact shape. Public URL proof
requires deployed Workers and cannot be completed from local files alone.
