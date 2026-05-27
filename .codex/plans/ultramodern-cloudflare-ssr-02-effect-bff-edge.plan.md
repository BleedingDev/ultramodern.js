---
name: Ultramodern Cloudflare SSR 02 Effect BFF Edge Runtime
overview: Make package-owned Effect BFF routes run inside the same Cloudflare Worker artifact as the vertical UI and SSR routes, without splitting the micro-vertical package.
todos:
  - id: classify-current-bff-runtime
    content: "Classify every Effect BFF runtime dependency as Worker-safe, Node-only, or unknown, including adapter setup, api/effect/index resolution, OpenAPI generation, context/layer creation, data platform support, and middleware mounting."
    status: completed
  - id: design-worker-bff-dispatch
    content: "Design a Worker-safe dispatcher for configured bff.prefix paths that invokes the existing Effect handler contract with Web Request/Response and does not require Node req/res or Fastify listen."
    status: completed
  - id: implement-direct-effect-handler-path
    content: "Implement or expose a direct Effect BFF handler path that the Worker deploy entry can call for api/effect/index or configured bff.effect.entry exports."
    status: completed
  - id: preserve-node-bff-path
    content: "Keep the existing Modern production server BFF mounting behavior intact for Node and future Zerops deployments."
    status: completed
  - id: add-bff-worker-tests
    content: "Add tests proving Worker dispatch for /commerce-api/effect/recommendations or an equivalent generated fixture returns JSON, proper status, headers, and package/version marker data."
    status: completed
  - id: validate-error-and-not-found-semantics
    content: "Verify Effect BFF errors, unsupported routes, method handling, and OpenAPI/static endpoints behave consistently between Node serve and Worker preview."
    status: completed
isProject: true
---

# Ultramodern Cloudflare SSR 02 Effect BFF Edge Runtime

## Execution Notes

The user requirement is explicit: a micro-vertical is one package containing FE and BE, including Effect. A UI-only Module Federation remote with an API elsewhere is not sufficient.

Known local evidence:

- `packages/server/core/src/types/config/bff.ts` defines `runtimeFramework?: 'hono' | 'effect'` and `effect` entry/openapi/dataPlatform config.
- `packages/cli/plugin-bff/src/server.ts` defaults runtime selection to Effect unless Hono is explicitly configured.
- `packages/cli/plugin-bff/src/runtime/effect/adapter.ts` resolves `api/effect/index` or `bff.effect.entry`, creates handlers from `createHandler` or `{ api, layer }`, passes a Web `Request`, and returns a Web `Response`.
- Current mounting still happens through Modern's server middleware context, so the deploy Worker needs a clean call path that avoids Node production server boot.

The implementation can either extract a reusable Effect handler factory from the existing adapter or add a small Worker-only wrapper around the existing factory. Prefer extraction if it reduces duplication and preserves behavior.

## Constraints

Do not expose backend modules through the browser Module Federation remote manifest.

Do not require a separate service package for the immediate Cloudflare proof.

Do not break Node production server behavior. The same generated vertical must later run as a long-running Node process on Zerops.

Do not fake BFF proof with static JSON. The HTTP response must come from the package-owned Effect API code.

## Operator Guidance

The minimum live route for proof should include:

- a health endpoint such as `/commerce-api/healthz`
- a business-like Effect endpoint such as `/commerce-api/effect/recommendations`
- response markers for package name, package version, git SHA or build ID, and selected vertical version/environment when available

The Worker entry should route BFF before SSR HTML fallback so API errors do not become rendered HTML pages.
