---
name: Ultramodern Cloudflare SSR 03 Zephyr SSR Upload
overview: Add a Zephyr SSR upload path for Modern.js Worker output that mirrors TanStack Start's server-plus-client snapshot model and uses Zephyr's public agent APIs.
todos:
  - id: verify-zephyr-agent-api
    content: "Reconfirm zephyr-agent uploadOutputToZephyr API, entrypoint detection, snapshotType behavior, auth behavior, and deployment callback shape against the installed/latest package."
    status: completed
  - id: design-modern-zephyr-upload-command
    content: "Decide whether Zephyr SSR upload is a Modern deploy preset end step, an opt-in script/harness, or generator-provided npm script; document why the choice does not create a competing Zephyr runtime."
    status: completed
  - id: implement-upload-wrapper
    content: "Implement a thin upload wrapper over zephyr-agent that passes rootDir, outputDir, publicDir, baseURL, builder metadata, target, ssr=true, and the Worker entrypoint without rewriting app runtime behavior."
    status: completed
  - id: capture-auth-and-login-flow
    content: "Support Zephyr's normal auth flow and document what happens when credentials are missing, including whether CLI login, browser prompt, server token, or secret token is required."
    status: completed
  - id: record-snapshot-evidence
    content: "Capture machine-readable deployment evidence: application UID, snapshot ID, entrypoint, snapshot type, deployment URL, MF manifest URL, and server/client asset list."
    status: completed
  - id: prove-no-rspack-client-regression
    content: "Verify the existing zephyr-rspack-plugin MF/client asset deployment still works or is clearly superseded for SSR snapshots, and document how the two paths coexist."
    status: completed
isProject: true
---

# Ultramodern Cloudflare SSR 03 Zephyr SSR Upload

## Execution Notes

This lane is about Zephyr packaging and deployment, not framework rendering. It should consume the Worker-compatible output from the Modern deploy preset and upload it through Zephyr's public SSR snapshot API surface.

Known public API evidence:

- `zephyr-agent@1.1.1` exports `uploadOutputToZephyr(opts)`.
- Options include `rootDir`, `outputDir`, `publicDir`, `baseURL`, `builder`, `target`, `ssr`, and `hooks`.
- Default `ssr` is true.
- Entry candidates include `server/index.js`, `server/index.mjs`, `server/server.js`, `server/server.mjs`, `server/_worker.js`, `server/_worker.mjs`, `index.mjs`, and `index.js`.
- Upload passes `snapshotType: ssr ? 'ssr' : 'csr'` and the detected entrypoint.
- TanStack's Zephyr plugin packages `dist/server` and `dist/client` together and uploads an SSR snapshot.

## Constraints

Do not use Zephyr browser extension state as the only proof. Browser login can be part of auth, but final evidence must include URLs and machine-readable snapshot/runtime data.

Do not hand-write Zephyr manifest rewrites or dynamic remote URL hacks.

Do not add a second source of truth for remote versions. Continue to use Zephyr remote dependency selectors, environment overrides, tags, or exact versions.

Do not hide upload failure behind successful local build output. Missing SSR entrypoint must fail loudly.

## Operator Guidance

The first working implementation can be an opt-in evidence harness if integrating into `modern deploy` is too invasive. The final generated workspace should make the recommended path discoverable and repeatable.

The output shape should intentionally match Zephyr's entrypoint scan to avoid requiring private Zephyr APIs. Prefer `server/index.mjs` for ESM projects.

## Lane Result - 2026-05-27

Implemented an opt-in wrapper under `scripts/ultramodern-zephyr-ssr-upload/` instead of wiring Zephyr upload directly into `modern deploy`. The wrapper consumes Modern Cloudflare `.output`, validates `server/index.mjs`, validates `wrangler.json` assets metadata, calls `uploadOutputToZephyr` with `builder: "modern-js"`, `target: "cloudflare"`, and `ssr: true`, then writes machine-readable evidence.

API verification used the published `zephyr-agent@1.1.1` tarball because the package is not currently installed in the root workspace or lockfile. The verified contract matches the lane assumptions: `uploadOutputToZephyr(opts)` accepts `rootDir`, `outputDir`, `publicDir`, `baseURL`, `builder`, `target`, `ssr`, and `hooks`; returns `{ deploymentUrl, entrypoint }`; uploads `snapshotType: "ssr"` when `ssr` is true; and invokes `hooks.onDeployComplete(deploymentInfo)` with URL, snapshot ID, snapshot, federated dependencies, and build stats when deployment completes.

The wrapper leaves `zephyr-rspack-plugin` alone. Existing Modern/Rspack Zephyr integration remains the MF/client asset path; this script is only the SSR snapshot upload/evidence path for Cloudflare Worker output.
