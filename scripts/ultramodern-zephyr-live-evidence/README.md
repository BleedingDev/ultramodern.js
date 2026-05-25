# Ultramodern Zephyr Live Evidence

This directory contains an opt-in evidence harness for full-stack Zephyr version
switching. It records the command plan, Zephyr selectors, app UIDs, manifest
URLs, runtime URLs, UI/API markers, and assertion results in a JSON bundle.

The harness uses the current public-docs assumptions gathered for the proof:

- The official Modern.js plugin package is `zephyr-modernjs-plugin`.
- Remote dependencies are configured with the `package.json`
  `zephyr:dependencies` key.
- Zephyr environment overrides can select remote versions, tags, or
  environments at runtime without rebuilding the host.
- Build commands remain normal Modern.js lifecycle commands, such as
  `pnpm install` and `pnpm build`. The harness does not define `zephyr:*`
  lifecycle commands.

Dry run:

```bash
node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js \
  --dry-run \
  --out /tmp/zephyr-evidence.json
```

Live mode:

```bash
ZE_ENV=staging \
ZE_USER_EMAIL=user@example.com \
ZE_SERVER_TOKEN=... \
ZE_REMOTE_V1_APP_UID=... \
ZE_REMOTE_V1_SELECTOR='@1.2.3' \
ZE_REMOTE_V1_MANIFEST_URL=https://.../mf-manifest.json \
ZE_REMOTE_V1_RUNTIME_URL=https://... \
ZE_REMOTE_V1_API_URL=https://.../commerce-api/version \
ZE_REMOTE_V2_APP_UID=... \
ZE_REMOTE_V2_SELECTOR='@1.2.4' \
ZE_REMOTE_V2_MANIFEST_URL=https://.../mf-manifest.json \
ZE_REMOTE_V2_RUNTIME_URL=https://... \
ZE_REMOTE_V2_API_URL=https://.../commerce-api/version \
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
