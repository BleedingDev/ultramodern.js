---
name: Ultramodern Cloudflare SSR 01 Modern Deploy Preset
overview: Add a first-class Modern.js Cloudflare Worker deploy target that emits a Worker-compatible server entry plus public assets while reusing Modern's existing workerSSR and edge rendering internals.
todos:
  - id: design-cloudflare-deploy-config
    content: "Add and type a Cloudflare deploy target without weakening existing node/vercel/netlify behavior; decide whether the public selector is MODERNJS_DEPLOY=cloudflare, deploy.provider=cloudflare, or both, and document precedence."
    status: completed
  - id: emit-worker-output-shape
    content: "Implement a deploy preset that writes a Cloudflare/Zephyr-compatible output shape, including .output/server/index.mjs or .output/server/index.js, public/client assets, route metadata, server bundles, and sourcemap filtering."
    status: completed
  - id: generate-worker-fetch-entry
    content: "Create a Worker entry template that exports fetch(request, env, ctx), loads Modern route metadata and server manifest data, dispatches SSR routes to render bundle requestHandler exports, and avoids createProdServer().listen()."
    status: completed
  - id: add-wrangler-output
    content: "Generate or document a wrangler.jsonc shape for the output, with main pointing at the Worker entry, assets bound to the public output directory, compatibility_date, nodejs_compat when required, and environment-variable handling."
    status: completed
  - id: preserve-existing-deploy-tests
    content: "Add unit and integration coverage for the new preset while proving node, vercel, netlify, ghPages, and existing workerSSR builder behavior remain unchanged."
    status: completed
  - id: validate-local-worker-entry
    content: "Run a generated fixture build and verify the emitted Worker entry imports successfully in a Worker-like runtime without Node listen/server dependencies."
    status: completed
isProject: true
---

# Ultramodern Cloudflare SSR 01 Modern Deploy Preset

## Execution Notes

This is the main framework implementation lane. It turns Modern's existing worker SSR build internals into a deployable Cloudflare Worker artifact.

Expected files to inspect and likely modify:

- `packages/solutions/app-tools/src/plugins/deploy/index.ts`
- `packages/solutions/app-tools/src/plugins/deploy/platforms/platform.ts`
- `packages/solutions/app-tools/src/plugins/deploy/platforms/node.ts`
- `packages/solutions/app-tools/src/plugins/deploy/platforms/templates/*`
- `packages/solutions/app-tools/src/plugins/deploy/utils/generator.ts`
- `packages/solutions/app-tools/src/types/config/deploy.ts`
- `packages/solutions/app-tools/src/plugins/analyze/getServerRoutes.ts`
- `packages/solutions/app-tools/src/builder/generator/getBuilderEnvironments.ts`
- `packages/runtime/plugin-runtime/src/cli/template.server.ts`
- `packages/server/core/src/plugins/render/ssrRender.ts`
- `packages/server/core/src/types/requestHandler.ts`

Implementation should be conservative. The Cloudflare preset should reuse the built render bundles and Web `RequestHandler` contract. The target Worker entry should not instantiate Fastify, Node HTTP servers, or `@modern-js/prod-server` listen paths.

Recommended output contract:

```text
.output/
  server/index.mjs
  public/
    mf-manifest.json
    static/
    locales/
  route.json
  server/
    modern.server files as needed
```

If the final Modern output shape cannot exactly match this tree, it must still satisfy both Cloudflare and Zephyr:

- Cloudflare can run a Worker `fetch` entry.
- Zephyr can upload all server and client files with an SSR entrypoint path.
- The generated artifact contains the micro-vertical's MF manifest and localized assets.

## Constraints

Do not use `corepack`. Use the repo's chosen package manager/tooling path.

Do not make Cloudflare the only production path. Node output must remain valid for later Zerops long-running deployment.

Do not depend on Vite-only hooks. Modern.js here is Rspack/Rsbuild-based; Cloudflare's Vite plugin is evidence for the TanStack pattern, not a direct dependency requirement.

Do not silently disable TypeScript declarations or Module Federation dts unless a hard runtime incompatibility is proven and documented.

## Operator Guidance

Start with a minimal Worker entry that can route SSR for one generated app. Then add asset serving and BFF dispatch. Keep all output decisions structured and testable: generated files, route metadata, and HTTP behavior are the contract.

If the server manifest loading path is unclear, build a temporary generated UltraModern workspace with `deploy.worker.ssr: true` and inspect the emitted `dist` and `route.json` shape before coding the final template.
