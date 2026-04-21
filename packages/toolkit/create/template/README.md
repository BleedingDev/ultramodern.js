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

The public opinionated entrypoint is `presetUltramodern(...)`. The older
`withAppBaseline(...)` helper remains only as a compatibility alias.

Preview the production build locally:

```bash
pnpm serve
```

For more information, see the
[UltraModern.js guide](https://modernjs.dev/en/guides/get-started/ultramodern.html)
and the [Modern.js documentation](https://modernjs.dev/en).
