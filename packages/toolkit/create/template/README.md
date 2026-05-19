# UltraModern.js 3.0 Starter

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

The generated starter also includes `.github/workflows/ultramodern-gates.yml`
and `.github/renovate.json`. The workflow runs `pnpm run ultramodern:check` and
`pnpm run build` on every push and pull request with read-only permissions,
commit-pinned actions, frozen installs, and StepSecurity audit-mode runner
hardening. Renovate is configured for dependency dashboard review, one-day
release age, grouped updates, action digest pinning, and manual approval for
major upgrades.

## Micro Vertical Workspaces

Inside a Micro Vertical workspace, generate shell, remote, and service packages
with `--sub` so the workspace root owns package-manager and CI policy:

```bash
npx @modern-js/create apps/shell --router tanstack --tailwind --workspace --sub
npx @modern-js/create apps/remotes/catalog --router tanstack --tailwind --workspace --sub
npx @modern-js/create apps/remotes/design-system --router tanstack --tailwind --workspace --sub
npx @modern-js/create services/catalog-api --bff-runtime effect --workspace --sub
```

The canonical topology is documented in
`docs/super-app-rfc-adr/WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`.
Shell packages own route assembly and topology selection, remote packages own
route subtrees and degraded UI, service packages own Effect or explicit Hono
contracts, and shared packages are limited to tokens, primitives, generated
clients, or domain-neutral utilities.

If the design system needs independent deployment, keep it as a horizontal
Module Federation remote with the same topology, trust, SSR compatibility, and
fallback rules as the vertical remotes. Do not add a second preset or a
design-system-specific framework mode.

The public opinionated entrypoint is `presetUltramodern(...)`. It is the default
UltraModern.js SuperApp surface for Effect, TanStack, SSR, BFF, and Micro
Verticals.

Preview the production build locally:

```bash
pnpm serve
```

For more information, see the
[UltraModern.js guide](https://bleedingdev.github.io/ultramodern.js/guides/get-started/ultramodern.html)
and the [UltraModern.js documentation](https://bleedingdev.github.io/ultramodern.js/).
