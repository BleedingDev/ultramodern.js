# UltraModern.js 3.0 Starter

This generated workspace is the Tractor reference SuperApp. It is built around
one shell and three full-stack Micro Verticals:

| Package | Boundary |
| --- | --- |
| `apps/shell-super-app` | Module Federation host, route assembly, topology selection, shell fallback policy |
| `apps/remotes/remote-explore` | Explore routes, MF exposes, locale JSON, CSS layer, and `/explore-api/effect/explore/*` |
| `apps/remotes/remote-decide` | Decide routes, MF exposes, locale JSON, CSS layer, and `/decide-api/effect/decide/*` |
| `apps/remotes/remote-checkout` | Checkout routes, MF exposes, locale JSON, CSS layer, and `/checkout-api/effect/checkout/*` |

Each vertical is a one-package ownership boundary. Its UI, Effect BFF contract,
generated client, `localisedUrls`, dynamic locale JSON, CSS, MF manifest, and
Cloudflare Worker output must move together for version-switching proof.

## Setup

Install the dependencies:

```bash
mise install
mise exec -- pnpm install
```

## Get Started

Start the dev server:

```bash
mise exec -- pnpm dev
```

Build the app for production:

```bash
mise exec -- pnpm build
```

Validate the generated Ultramodern preset contract locally:

```bash
mise exec -- pnpm run ultramodern:check
```

Run the normal local gates before treating the scaffold as adoption-ready:

```bash
mise exec -- pnpm run check
mise exec -- pnpm run build
mise exec -- pnpm run cloudflare:build
```

The generated preset defaults are opt-out. Disable specific contracts via env vars:

```bash
MODERN_BASELINE_ENABLE_MF_SSR=false
MODERN_BASELINE_ENABLE_BFF_REQUEST_ID=false
MODERN_BASELINE_ENABLE_TELEMETRY_EXPORTERS=false
```

The generated starter also includes `.github/workflows/ultramodern-gates.yml`
and `.github/renovate.json`. The workflow runs
`mise exec -- pnpm run ultramodern:check` and `mise exec -- pnpm run build` on
every push and pull request with read-only permissions, commit-pinned actions,
frozen installs, and StepSecurity audit-mode runner hardening. Renovate is
configured for dependency dashboard review, one-day release age, grouped
updates, action digest pinning, and manual approval for major upgrades.

## Micro Vertical Workspaces

Inside a Micro Vertical workspace, add packages from the workspace root with
the UltraModern add flow. It derives paths, package names, ports, Module
Federation names, topology entries, overlays, ownership, and root dev scripts:

```bash
mise exec -- pnpm dlx @modern-js/create catalog --microvertical remote
mise exec -- pnpm dlx @modern-js/create design-system --microvertical horizontal-remote
mise exec -- pnpm dlx @modern-js/create catalog-api --microvertical service
mise exec -- pnpm dlx @modern-js/create catalog-contracts --microvertical shared
```

The canonical topology is documented in
`docs/super-app-rfc-adr/WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`.
Shell packages own route assembly and topology selection, remote packages own
route subtrees and degraded UI, service packages own Effect or explicit Hono
contracts, and shared packages are limited to tokens, primitives, generated
clients, or domain-neutral utilities.

Use a new vertical only when the feature needs its own route subtree owner,
independent rollout, rollback, Cloudflare/Zephyr evidence, or incident routing.
Keep code inside an existing vertical when it shares the same product owner,
fallback behavior, release train, and Effect contract. Do not use a shared
package for feature composites or workflow state.

If the design system needs independent deployment, keep it as a horizontal
Module Federation remote with the same topology, trust, SSR compatibility, and
fallback rules as the vertical remotes. Do not add a second preset or a
design-system-specific framework mode.

The public opinionated entrypoint is `presetUltramodern(...)`. It is the default
UltraModern.js SuperApp surface for Effect, TanStack, SSR, BFF, and Micro
Verticals.

## Module Federation And Effect Ownership

The shell consumes vertical UI through MF manifests and consumes vertical data
through generated Effect clients exported by the remote packages:

- Explore exposes header, footer, recommendations, store picker, and route UI.
- Decide exposes product page and route UI, and may consume Explore or Checkout
  remotes through declared `remoteRefs`.
- Checkout exposes cart, checkout, thanks, mini-cart, add-to-cart, and route UI.

The shell owns orchestration and fallback policy. A vertical owns its route-local
loader/action behavior, degraded UI, `api/effect/index.ts`, shared Effect API
contract, generated client, and readiness endpoint. Hono remains a compatibility
lane only when explicitly scaffolded outside the default Tractor workspace.

## I18n And CSS Ownership

Route localization is owned by the package that owns the route. Each app emits
`src/routes/ultramodern-route-metadata` and passes
`ultramodernLocalisedUrls` to `@modern-js/plugin-i18n`. Dynamic JSON resources
are served from `/locales/{{lng}}/{{ns}}.json`; shell rewrites must not replace
remote-owned localized URL maps.

CSS federation is recorded in `.modernjs/ultramodern-generated-contract.json`:

- `packages/shared-design-tokens` owns `ultramodern-shared-tokens` and exports
  `./tokens.css`.
- The shell owns shell base and overlay CSS under its app root marker.
- Each remote owns one vertical CSS layer and one remote app root marker.
- Tailwind CSS v4 is app-local through `@tailwindcss/postcss`.
- Duplicate base styles are forbidden. SSR first paint requires shared tokens
  and Modern/Rspack-emitted app CSS.

## Cloudflare And Zephyr Evidence

Build all Cloudflare Worker artifacts:

```bash
MODERN_PUBLIC_SITE_URL=https://shell-super-app.example.test mise exec -- pnpm run cloudflare:build
```

Validate local or deployed Cloudflare output with the repo harness:

```bash
node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js \
  --root-dir apps/remotes/remote-checkout \
  --bff /checkout-api/effect/checkout/readiness \
  --expect-en "Checkout Remote" \
  --match-build-marker \
  --out .codex/reports/cloudflare-ssr/remote-checkout-local.json
```

After deploying public Workers, run the generated public URL proof:

```bash
ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://shell-super-app.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_EXPLORE=https://remote-explore.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_DECIDE=https://remote-decide.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_CHECKOUT=https://remote-checkout.example.workers.dev \
mise exec -- pnpm run cloudflare:proof -- --require-public-urls
```

Zephyr upload and live switching proof are opt-in evidence workflows. The
workspace records `zephyr:dependencies` and wires `zephyr-rspack-plugin`, but
live proof still requires public manifest, runtime, and API URLs plus Zephyr
credentials. Without those values, only dry-run Zephyr evidence can be claimed.

Preview the production build locally:

```bash
mise exec -- pnpm serve
```

For more information, see the
[UltraModern.js guide](https://bleedingdev.github.io/ultramodern.js/guides/get-started/ultramodern.html)
and the [UltraModern.js documentation](https://bleedingdev.github.io/ultramodern.js/).
