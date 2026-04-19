# Modern.js with Stronger Defaults

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

Validate baseline contract locally:

```bash
pnpm run baseline:check
```

Baseline defaults are opt-out. Disable specific contracts via env vars:

```bash
MODERN_BASELINE_ENABLE_MF_SSR=false
MODERN_BASELINE_ENABLE_BFF_REQUEST_ID=false
MODERN_BASELINE_ENABLE_TELEMETRY_EXPORTERS=false
```

The generated starter also includes `.github/workflows/uniform-baseline-gates.yml`.
That workflow runs `pnpm run baseline:check` and `pnpm run build` on every push
and pull request so the stronger-default baseline stays explicit.

Preview the production build locally:

```bash
pnpm serve
```

For more information, see the
[stronger-default Modern.js guide](https://modernjs.dev/en/guides/get-started/ultramodern.html)
and the [Modern.js documentation](https://modernjs.dev/en).
