# Zephyr SSR Upload Lane - 2026-05-27

Graph: `ultramodern-cloudflare-ssr-00-evidence-contract-plus-7-plans-21b4ea7f53`

## Result

Implemented an opt-in Modern Cloudflare SSR upload wrapper:

- `scripts/ultramodern-zephyr-ssr-upload/upload-zephyr-ssr.js`
- `scripts/ultramodern-zephyr-ssr-upload/__tests__/upload-zephyr-ssr.test.js`
- `scripts/ultramodern-zephyr-ssr-upload/README.md`

The wrapper validates `.output/server/index.mjs`, `.output/wrangler.json`, `wrangler.assets.directory`, `wrangler.assets.binding`, and the referenced public assets directory before upload. It then calls `uploadOutputToZephyr` with:

```json
{
  "builder": "modern-js",
  "target": "cloudflare",
  "ssr": true
}
```

It passes through resolved `rootDir`, `outputDir`, `publicDir`, and `baseURL`, and records JSON evidence containing the Zephyr deployment URL, snapshot ID, snapshot type, entrypoint, application UID, MF manifest URL, federated dependencies, Wrangler metadata, and server/public/worker asset lists when the agent returns those values.

## API Verification

The root workspace does not currently install `zephyr-agent`, and `pnpm-lock.yaml` has no local package entry for it. I verified the public package artifact instead:

- `pnpm view zephyr-agent@1.1.1 version exports main types --json`
- `pnpm view zephyr-agent version --json`
- `npm pack zephyr-agent@1.1.1 --pack-destination /tmp/modernjs-zephyr-agent-verify`

Verified from `dist/lib/upload-output-to-zephyr.d.ts` and `dist/lib/upload-output-to-zephyr.js`:

- `uploadOutputToZephyr(opts)` is exported from `zephyr-agent`.
- Options are `rootDir`, `outputDir`, `publicDir`, `baseURL`, `builder`, `target`, `ssr`, and `hooks`.
- Return shape is `{ deploymentUrl: string | null, entrypoint?: string }`.
- SSR defaults to true.
- Entry candidates include `server/index.js`, `server/index.mjs`, `server/server.js`, `server/server.mjs`, `server/_worker.js`, `server/_worker.mjs`, `index.mjs`, and `index.js`.
- SSR upload passes `snapshotType: "ssr"` and the detected entrypoint.
- `hooks.onDeployComplete(deploymentInfo)` receives URL, snapshot ID, snapshot, federated dependencies, and build stats.

## Auth Notes

Authentication remains owned by `zephyr-agent`.

Local interactive behavior:

- If `ZE_SECRET_TOKEN`, `ZE_SERVER_TOKEN`, or a CI-derived token is available, the agent uses that path.
- If a persisted token is valid, the agent reports the user is already logged in.
- If no valid token exists in an interactive shell, the agent requests Zephyr login, prints the auth URL, attempts to open the browser, waits for browser completion, and persists the token.

Non-interactive behavior:

- The agent warns when no secret token is available.
- CI/live validation should provide `ZE_SECRET_TOKEN` or `ZE_SERVER_TOKEN`.
- Browser extension state is not proof; Plan 06 must capture returned deployment/snapshot evidence and HTTP runtime evidence.

## Coexistence With Rspack Zephyr

This does not replace `zephyr-rspack-plugin`.

- `zephyr-rspack-plugin` remains the Modern/Rspack MF and client asset integration path.
- The new script is a narrow SSR snapshot upload/evidence path for Modern Cloudflare `.output`.
- It does not rewrite Zephyr manifests, add `zephyr:*` lifecycle commands, or create a competing remote-version source of truth.

## Validation

Passed:

```bash
node --test scripts/ultramodern-zephyr-ssr-upload/__tests__/upload-zephyr-ssr.test.js
pnpm exec biome check --files-ignore-unknown=true --no-errors-on-unmatched scripts/ultramodern-zephyr-ssr-upload/upload-zephyr-ssr.js scripts/ultramodern-zephyr-ssr-upload/__tests__/upload-zephyr-ssr.test.js scripts/ultramodern-zephyr-ssr-upload/README.md
```

The tests stub the `zephyr-agent` boundary and assert behavior through generated Cloudflare output, upload options, hook callback data, and written evidence JSON. They do not inspect source-code text.

## Remaining

Live Zephyr deployment is intentionally left to Plan 06. That lane must run this wrapper with real Zephyr credentials, archive the evidence JSON, and verify HTTP behavior from the returned Cloudflare/Zephyr SSR deployment.
