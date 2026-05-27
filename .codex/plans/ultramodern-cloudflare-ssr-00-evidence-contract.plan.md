---
name: Ultramodern Cloudflare SSR 00 Evidence Contract
overview: Lock the codebase, Zephyr, Cloudflare, TanStack Start, and package-version evidence that the Worker SSR/BFF implementation must preserve before any deploy adapter work starts.
todos:
  - id: verify-current-package-apis
    content: "Reconfirm current public package/API baselines before implementation: zephyr-agent, zephyr-rspack-plugin, vite-plugin-tanstack-start-zephyr, @cloudflare/vite-plugin, wrangler, @tanstack/react-start, @module-federation/modern-js-v3, TypeScript, and @typescript/native-preview."
    status: completed
  - id: map-modern-worker-ssr-internals
    content: "Trace Modern.js worker SSR internals and record exact files/functions for deploy.worker.ssr, workerSSR environment generation, MODERN_SSR_ENV=edge, server render bundle exports, route.json worker metadata, and stream rendering."
    status: completed
  - id: map-effect-bff-edge-contract
    content: "Trace Effect BFF runtime to prove which pieces already accept Web Request/Response and which pieces are tied to Modern's Node production server or Hono middleware context."
    status: completed
  - id: map-zephyr-ssr-snapshot-contract
    content: "Record the Zephyr SSR snapshot contract from zephyr-agent 1.1.1 and vite-plugin-tanstack-start-zephyr: outputDir, publicDir, entrypoint candidates, snapshotType=ssr, and deployment URL callback behavior."
    status: completed
  - id: define-non-negotiable-acceptance
    content: "Publish the non-negotiable acceptance matrix: translated SSR routes, locale assets, MF manifest, remote UI marker, Effect BFF marker, version/environment selector evidence, Wrangler preview, and Zephyr SSR snapshot evidence."
    status: completed
isProject: true
---

# Ultramodern Cloudflare SSR 00 Evidence Contract

## Execution Notes

Source bead: `modernjs-z0z9`.

This plan is the evidence gate for the Cloudflare/Zephyr Worker SSR program. Agents must not start by inventing a runtime. They must first anchor implementation choices in the current repo and the public APIs that were verified on 2026-05-26.

Known local evidence to preserve:

- `packages/solutions/app-tools/src/plugins/deploy/index.ts` exposes `node`, `vercel`, `netlify`, and `ghPages`; there is no Cloudflare deploy preset.
- `packages/solutions/app-tools/src/builder/generator/getBuilderEnvironments.ts` creates a `workerSSR` environment with `target: 'web-worker'` when `isServiceWorker(normalizedConfig)` is true.
- `packages/toolkit/utils/src/cli/is/config.ts` treats `deploy.worker.ssr` plus SSR/SSG as the service worker condition.
- `packages/runtime/plugin-runtime/src/cli/ssr/index.ts` treats `workerSSR` as a server environment and sets `process.env.MODERN_SSR_ENV` to `edge` for `deploy.worker.ssr`.
- `packages/runtime/plugin-runtime/src/cli/template.server.ts` emits a Web `Request -> Response` `requestHandler`.
- `packages/runtime/plugin-runtime/src/core/server/stream/index.ts` selects the worker stream renderer when `MODERN_SSR_ENV === 'edge'`.
- `packages/cli/plugin-bff/src/runtime/effect/adapter.ts` calls an Effect API handler with Web `Request` and returns Web `Response`, but current production mounting happens through Modern server middleware.
- `packages/solutions/app-tools/src/plugins/deploy/platforms/templates/node-entry.mjs` creates a Node production server and calls `listen`; this cannot be the Cloudflare Worker entry.

Known external evidence to preserve:

- Zephyr TanStack Start SSR uses an SSR Worker snapshot, not just Rspack/MF client asset upload.
- `zephyr-agent@1.1.1` `uploadOutputToZephyr` defaults `ssr` to true, scans entrypoint candidates including `server/index.js`, `server/index.mjs`, `server/_worker.js`, `index.mjs`, and `index.js`, and uploads `snapshotType: 'ssr'` plus `entrypoint`.
- `vite-plugin-tanstack-start-zephyr@1.1.1` reads the whole TanStack output directory and uploads server and client files with an SSR snapshot entrypoint.
- The current Cloudflare TanStack Start guide uses Cloudflare's Vite plugin and a Worker-compatible server entry.
- `@cloudflare/vite-plugin@1.39.0` depends on `wrangler@4.95.0` and `miniflare@4.20260526.0`; it officially supports SSR meta-framework builds in the Workers runtime.

## Constraints

Do not claim Zephyr full-stack proof from the existing `zephyr-rspack-plugin` Modern.js path. That path is valid for MF/client assets, but it does not prove Worker SSR or Effect BFF execution.

Do not split the Effect BFF into a separate package. The micro-vertical boundary is one package containing FE, SSR, MF artifacts, and owned Effect API behavior.

Do not hardcode Zephyr dashboard state, browser-extension state, or local-only URLs as runtime behavior. Version and environment switching evidence must be machine-readable where possible.

Do not add content-source-code tests that only grep for arbitrary source strings. Validation must assert generated config, build outputs, manifests, HTTP behavior, or structured package metadata.

## Operator Guidance

This plan should be completed first and then treated as the stable handoff to all parallel implementation agents. If package versions changed after 2026-05-26, update this plan's evidence references and the implementation plans before coding.

Primary external references:

- `https://docs.zephyr-cloud.io/meta-frameworks/tanstack-start`
- `https://docs.zephyr-cloud.io/reference/ssr-worker`
- `https://docs.zephyr-cloud.io/meta-frameworks/modernjs`
- `https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/`
- `https://developers.cloudflare.com/workers/vite-plugin/`
- `https://github.com/ZephyrCloudIO/zephyr-packages/blob/main/libs/vite-plugin-tanstack-start-zephyr/src/lib/vite-plugin-tanstack-start-zephyr.ts`
- `https://github.com/ZephyrCloudIO/zephyr-packages/tree/main/libs/zephyr-agent`
- `https://github.com/TanStack/router/tree/main/examples/react/start-basic-cloudflare`
