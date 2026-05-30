# UltraModern.js 3.0 Starter

This generated app is a simple UltraModern.js starting point. It gives one app
with localized routes, production URL metadata, optional BFF support, Rstest,
Oxlint, oxfmt, and a local contract check. You can build a useful product here
without deleting fake product areas, shell packages, or deployment topology.

## Setup

Install the dependencies:

```bash
mise install
pnpm install
```

## Get Started

Start the dev server:

```bash
pnpm dev
```

Build the app for production:

```bash
MODERN_PUBLIC_SITE_URL=https://example.com pnpm build
```

Preview the production build locally:

```bash
pnpm serve
```

Run the local gates before treating the scaffold as ready:

```bash
pnpm run ultramodern:check
MODERN_PUBLIC_SITE_URL=https://example.com pnpm run build
```

## What You Get

The default app is intentionally monolith-friendly:

| Area | Starting Point |
| --- | --- |
| App routes | Locale-prefixed pages under `src/routes/[lang]` |
| Copy | English and Czech resources in `config/public/locales` |
| Styling | App-local CSS, with Tailwind files only when selected |
| Server logic | Optional BFF entrypoints under `api/` |
| Tests | Rstest smoke coverage in `tests/` |
| Agent workflow | Generated `AGENTS.md`, hooks, and local quality gates |

Keep feature code in the app while one team owns the workflow, release train,
and operational behavior. Add ordinary workspace packages for shared tokens,
small UI primitives, generated clients, or domain-neutral utilities when that
keeps the app easier to understand.

## Customize The App

Start with the generated page and replace the placeholder cards with your first
real routes, actions, and API calls. Put user-visible text in
`config/public/locales/<lang>/translation.json`, then render it through
`react-i18next` or `@modern-js/plugin-i18n/runtime`.

Tune the preset in `modern.config.ts`. Production builds require
`MODERN_PUBLIC_SITE_URL` so canonical and `hreflang` URLs use your deployed
origin. The local fallback is `http://localhost:8080`.

The generated preset defaults are opt-out. Disable specific contracts via env
vars when your app needs a softer lane:

```bash
MODERN_BASELINE_ENABLE_MF_SSR=false
MODERN_BASELINE_ENABLE_BFF_REQUEST_ID=false
MODERN_BASELINE_ENABLE_TELEMETRY_EXPORTERS=false
```

## Grow When Needed

Stay in the single app until a boundary has a real owner and operational reason
to split. A separate package is usually enough when you only need reusable code.
Consider a larger workspace boundary later when a feature needs independent
ownership, rollout, rollback, incident routing, or deployment evidence.

The public opinionated entrypoint is `presetUltramodern(...)`. It keeps Effect,
TanStack, SSR, BFF, i18n, and quality gates available without requiring a
distributed app layout on day one.

## Generated Automation

The generated starter includes `.github/workflows/ultramodern-gates.yml` and
`.github/renovate.json` for full app projects. The workflow runs
`pnpm run ultramodern:check` and `pnpm run build` on every push and pull request
with read-only permissions, commit-pinned actions, frozen installs, and
StepSecurity audit-mode runner hardening. Renovate is configured for dependency
dashboard review, one-day release age, grouped updates, action digest pinning,
and manual approval for major upgrades.

For more information, see the
[UltraModern.js guide](https://bleedingdev.github.io/ultramodern.js/guides/get-started/ultramodern.html)
and the [UltraModern.js documentation](https://bleedingdev.github.io/ultramodern.js/).
