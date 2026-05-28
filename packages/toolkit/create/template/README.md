# UltraModern.js 3.0 Starter

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

If the design system needs independent deployment, keep it as a horizontal
Module Federation remote with the same topology, trust, SSR compatibility, and
fallback rules as the vertical remotes. Do not add a second preset or a
design-system-specific framework mode.

The public opinionated entrypoint is `presetUltramodern(...)`. It is the default
UltraModern.js SuperApp surface for Effect, TanStack, SSR, BFF, and Micro
Verticals.

Preview the production build locally:

```bash
mise exec -- pnpm serve
```

For more information, see the
[UltraModern.js guide](https://bleedingdev.github.io/ultramodern.js/guides/get-started/ultramodern.html)
and the [UltraModern.js documentation](https://bleedingdev.github.io/ultramodern.js/).
