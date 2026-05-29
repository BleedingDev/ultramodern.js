# Ultramodern Zephyr Live Evidence

This directory contains an opt-in evidence harness for full-stack Zephyr version
switching across the Tractor Explore, Decide, and Checkout verticals. It records
the command plan, Zephyr selectors, app UIDs, manifest URLs, runtime URLs,
UI/API/CSS/i18n markers, and assertion results in a JSON bundle.

The harness uses the current public-docs assumptions gathered for the proof:

- Zephyr deployment uses `zephyr-rspack-plugin` through the generated Modern.js
  Rspack config bridge.
- Remote dependencies are configured with the `package.json`
  `zephyr:dependencies` key.
- Zephyr environment overrides can select remote versions, tags, or
  environments at runtime without rebuilding the host.
- Build commands remain normal Modern.js lifecycle commands, such as
  `pnpm install` and `pnpm build`. The harness does not define `zephyr:*`
  lifecycle commands.

The evidence boundary is intentionally full-stack. For each Tractor vertical,
the selected v1 or v2 target must expose matching UI, Effect API, CSS, i18n JSON,
and MF manifest markers. A shell render that changes only the MF UI does not
prove the vertical's Effect ownership or route-owned i18n/CSS contract.

Dry run:

```bash
node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js \
  --dry-run \
  --out /tmp/zephyr-evidence.json
```

Dry run writes a command plan, expected selectors, marker assertions, and the
schema-backed evidence bundle without fetching Zephyr URLs. Use it to review
configuration before credentials or public URLs are available.

Live mode:

```bash
ZE_ENV=staging \
ZE_USER_EMAIL=user@example.com \
ZE_SERVER_TOKEN=... \
ZE_REMOTE_EXPLORE_V1_APP_UID=... \
ZE_REMOTE_EXPLORE_V1_SELECTOR='@1.2.3' \
ZE_REMOTE_EXPLORE_V1_MANIFEST_URL=https://.../mf-manifest.json \
ZE_REMOTE_EXPLORE_V1_RUNTIME_URL=https://... \
ZE_REMOTE_EXPLORE_V1_API_URL=https://.../explore-api/effect/explore/readiness \
ZE_REMOTE_EXPLORE_V2_APP_UID=... \
ZE_REMOTE_EXPLORE_V2_SELECTOR='@1.2.4' \
ZE_REMOTE_EXPLORE_V2_MANIFEST_URL=https://.../mf-manifest.json \
ZE_REMOTE_EXPLORE_V2_RUNTIME_URL=https://... \
ZE_REMOTE_EXPLORE_V2_API_URL=https://.../explore-api/effect/explore/readiness \
ZE_SHELL_APP_UID=... \
ZE_SHELL_SELECTOR=staging \
ZE_SHELL_MANIFEST_URL=https://.../mf-manifest.json \
ZE_SHELL_RUNTIME_URL=https://... \
node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js \
  --live \
  --out /tmp/zephyr-evidence.json
```

The JSON bundle points at `evidence-bundle.schema.json` and redacts credential
values before writing inputs.

## Required Live Inputs

Live mode requires all of these classes of input:

| Input | Purpose |
| --- | --- |
| `ZE_ENV` | Names the Zephyr environment selector used by the shell. |
| `ZE_USER_EMAIL` plus `ZE_SERVER_TOKEN` or `ZE_SECRET_TOKEN` | Authenticates Zephyr evidence fetches. |
| `ZE_REMOTE_<VERTICAL>_V1_*` and `ZE_REMOTE_<VERTICAL>_V2_*` | Provide app UID, selector, manifest URL, runtime URL, and API readiness URL for Explore, Decide, and Checkout. |
| `ZE_SHELL_*` | Provides shell app UID, selector, manifest URL, and runtime URL. |

The harness accepts explicit versions, tags, or environment selectors, matching
Zephyr remote dependency and environment override behavior. Selectors should be
the operational value used to switch the shell, not a local note that cannot be
replayed.

## Version Switching Workflow

1. Build each remote with normal Modern.js commands.
2. Upload through the generated Zephyr Rspack bridge or the SSR upload helper
   when validating Cloudflare SSR output.
3. Record the Zephyr app UID, selected version or tag, public manifest URL,
   public runtime URL, and public Effect readiness URL for v1 and v2.
4. Configure the shell's Zephyr dependency or environment override to select
   the target version.
5. Run the live harness and attach the evidence JSON to the release or graph
   lane.

Supported evidence paths:

```bash
# Review the plan without network proof.
node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js \
  --dry-run \
  --out .codex/reports/zephyr-live/tractor-dry-run.json

# Fetch public Zephyr/Worker URLs and assert marker lockstep.
ZE_ENV=staging \
ZE_USER_EMAIL=user@example.com \
ZE_SERVER_TOKEN=... \
node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js \
  --live \
  --config .codex/zephyr-live/tractor-staging.json \
  --out .codex/reports/zephyr-live/tractor-staging-live.json
```

## Known Limitation

Live Zephyr proof cannot be completed from repository contents alone. It
requires public runtime, manifest, and API URLs for the selected shell and
remote versions, plus valid Zephyr credentials. When those are missing, report
the dry-run evidence as configuration proof only and leave live version
selection open.
