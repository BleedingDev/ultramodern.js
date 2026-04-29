# Modern.js `presetUltramodern` Starter

## Setup

Install the dependencies:

```bash
pnpm install
```

## Get Started

Start the dev server:

```bash
pnpm dev
```

Build the app for production:

```bash
pnpm build
```

Validate the generated Ultramodern preset contract locally:

```bash
pnpm run ultramodern:check
```

The generated preset defaults are opt-out. Disable specific contracts via env vars:

```bash
MODERN_BASELINE_ENABLE_MF_SSR=false
MODERN_BASELINE_ENABLE_BFF_REQUEST_ID=false
MODERN_BASELINE_ENABLE_TELEMETRY_EXPORTERS=false
```

The generated starter also includes `.github/workflows/ultramodern-gates.yml`.
That workflow runs `pnpm run ultramodern:check` and `pnpm run build` on every
push and pull request so the `presetUltramodern(...)` contract stays explicit.

## Micro Vertical Workspaces

Inside a Micro Vertical workspace, generate shell, remote, and service packages
with `--sub` so the workspace root owns package-manager and CI policy:

```bash
npx @modern-js/create apps/shell --router tanstack --tailwind --workspace --sub
npx @modern-js/create apps/remotes/catalog --router tanstack --tailwind --workspace --sub
npx @modern-js/create services/catalog-api --bff-runtime effect --workspace --sub
```

The canonical topology is documented in
`docs/super-app-rfc-adr/WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`.
Shell packages own route assembly and topology selection, remote packages own
route subtrees and degraded UI, service packages own Effect or explicit Hono
contracts, and shared packages are limited to tokens, primitives, generated
clients, or domain-neutral utilities.

The public opinionated entrypoint is `presetUltramodern(...)`. The older
`withAppBaseline(...)` helper remains only as a compatibility alias.

Preview the production build locally:

```bash
pnpm serve
```

For more information, see the
[UltraModern.js guide](https://modernjs.dev/en/guides/get-started/ultramodern.html)
and the [Modern.js documentation](https://modernjs.dev/en).
