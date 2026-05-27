# Ultramodern Zephyr SSR Upload

This is an opt-in evidence wrapper for uploading Modern.js Cloudflare SSR output
through Zephyr's public agent API. It does not replace the normal Modern.js
build lifecycle and it does not add `zephyr:*` package scripts.

```bash
node scripts/ultramodern-zephyr-ssr-upload/upload-zephyr-ssr.js \
  --root-dir apps/shell-super-app \
  --output-dir .output \
  --out .output/zephyr-ssr-upload-evidence.json
```

The wrapper validates the Cloudflare output before upload:

- `.output/server/index.mjs` must exist.
- `.output/wrangler.json` must declare `assets.directory` and
  `assets.binding`.
- The public assets directory referenced by Wrangler must exist.

The upload call is intentionally thin:

- `builder: "modern-js"`
- `target: "cloudflare"`
- `ssr: true`
- `rootDir`, `outputDir`, `publicDir`, and `baseURL` are passed through to
  `uploadOutputToZephyr`.

Authentication is owned by `zephyr-agent`. In local interactive use, the agent
can open a browser login flow and persist the token. In CI or non-interactive
runs, provide Zephyr token environment variables supported by the agent, such as
`ZE_SECRET_TOKEN` or `ZE_SERVER_TOKEN`. Browser extension state is not used as
proof; the evidence JSON records returned deployment and snapshot data when the
agent provides it.
