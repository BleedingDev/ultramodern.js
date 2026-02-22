# Modern.js App

## Setup

Install the dependencies:

```bash
pnpm install
```

## Get Started

Start the start server:

```bash
pnpm start
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

Preview the production build locally:

```bash
pnpm serve
```

For more information, see the [Modern.js documentation](https://modernjs.dev/en).
