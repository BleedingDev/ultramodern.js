# ADR-0021: Distributed SSR for Module Federation on Cloudflare Workers

Status: Accepted (build in progress)
Date: 2026-07-14
Deciders: Petr Glaser (owner), Fable (integrator), independent Codex/gpt-5.6-sol review

## Context

The generated super-app shell is a Module Federation **host** that SSRs remote vertical widgets (`src/routes/vertical-components.tsx` → `createLazyComponent(() => import('<remote>/Widget'))`). On the Cloudflare `workerSSR` build this fails: `Module not found: Can't resolve '<remote>/Widget'` for all remotes. Two independent investigations (Fable + Codex) converged:

- **Build cause:** `packages/solutions/app-tools/src/builder/generator/getBuilderEnvironments.ts:438` executes `chain.plugins.delete('plugin-module-federation')` for the Cloudflare worker-SSR env (added in `544719f115`, when worker-SSR apps were not MF hosts). Locked by `packages/solutions/app-tools/tests/builder/index.test.ts:288`.
- **Runtime cause (the real wall):** MF 2.7.0 has no workerd runtime. `@module-federation/runtime-core/.../utils/load.js:130-154` offers only a DOM loader (`document`/`<script>`) and a Node loader (`fs`/`vm`/`createRequire`/`eval`/`new Function`). Cloudflare Workers forbid runtime `eval`/executing fetched remote code. **Executing remote code inside a host Worker is impossible**, so no build tweak or dependency patch can make in-process MF SSR work on Workers.

## Decision

SSR is non-negotiable (product thesis: MicroVerticals stay independently deployable **and** server-rendered). Adopt **distributed SSR / fragment composition**:

- Each vertical Worker SSRs its **own** `Widget` expose (it owns that code locally — no remote loading).
- The shell Worker, at SSR, fetches each vertical's SSR fragment over a **Worker-to-Worker service binding** and injects it at the boundary.
- The browser hydrates each fragment via normal browser MF (browsers allow the DOM loader).

No remote code ever executes inside a host Worker. Each Worker executes only its own deployed module graph — runtime-correct on workerd.

Key simplification: **verticals already SSR successfully on their own Workers** (their `cloudflare:build` passes today; only the shell fails). So the remote half is largely "expose a fragment route that renders the existing Widget," not new SSR machinery.

## Architecture / insertion points

1. **Vertical fragment SSR endpoint** — a route/handler that SSRs the vertical's `Widget` (`demo-components.ts:270 createRemoteWidget`, boundary markers already at :281) to `{ boundaryId, html, state, cssHrefs, remoteEntry, version }`. Generated via `write-app.ts` (`writeAppFile('src/routes/...')`). Reuses the vertical's working worker streaming SSR (`plugin-runtime/.../stream/createReadableStream.worker.ts`, `@modern-js/render/ssr`).
2. **Shell `ServerFragment` composition** — new runtime primitive: on worker SSR, read the binding from context, `await env[binding].fetch('/_mf/fragment/Widget?p=…')`, inject HTML + boundary markers + inline hydration state; Suspense/stream so a slow remote never blocks the shell.
3. **`createRemoteComponent` helper** (`vertical-components.helpers.tsx`) becomes environment-aware: worker → `ServerFragment`; client → `createLazyComponent` (hydrate). Call-site (`demo-components.ts:65-112 createShellRemoteComponents`) passes `{ remote, binding, expose, loader }`.
4. **`env` threading** — `env` reaches the worker fetch handler but is dropped at `cloudflare-entry.004 getRequestHandlerOptions` (only reads assets). Thread `env`/bindings into `createRequestHandlerOptions` → the SSR `runtimeContext` so `ServerFragment` can reach the binding.
5. **Build env transform** — replace `getBuilderEnvironments.ts:438` delete with an env-aware transform: worker SSR keeps MF **compile** config so the client `loader` import resolves (externalized, client-only) but the SSR render never executes the remote container; client env keeps full browser MF. Update `tests/builder/index.test.ts:288`.
6. **Wrangler / manifest** — emit shell→vertical UI service bindings (`wrangler-config.ts` services[], `deploy.ts` types); shell manifest maps `<remote> → { binding, fragmentBase }`. Reuse existing dispatch (`cloudflare-entry.005/006`) and CSS collection (`004`).
7. **Fallback** — typed placeholder + `MICROVERTICAL_SERVER_FALLBACK_EVENT` when a remote is down.

## Phases (each validated in workerd — miniflare/wrangler, never Node)

1. Vertical fragment SSR endpoint (+ miniflare SSR test).
2. Shell `ServerFragment` compose + `env` threading + build env transform.
3. Wrangler UI service bindings + manifest mapping.
4. Hydration correctness (props serialization, no mismatch, version match).
5. Typed fallback / resilience.
6. workerd acceptance wired into ERP-10: JS-off HTML carries all 10 remotes' SSR markers, zero remote-JS fetched by the Worker; JS-on hydrates all 10 with correct CSS; fallback verified. Then push/publish `.45`.

## Validation contract

Run in workerd. Assert no unresolved remote specifiers and no `@module-federation/node`/`fs`/`vm` in the Worker graph. JS-disabled raw HTML must contain unique SSR-only markers from all 10 remotes. Manifest/CSS-link/build-marker tests do NOT prove remote execution.

## Rejected alternatives

- **Client-only remotes** (NoSSR + browser hydrate): violates the SSR-everywhere thesis.
- **In-process MF SSR on the Worker** / `pnpm patch` toward fetch-and-execute: impossible (Workers forbid eval; MF 2.7.0 has no edge runtime). A patch is legitimate ONLY for MF's scalar `csrEnv/ssrEnv` multi-env defect (`ssrPlugin.mjs:75-117`), never to add edge execution.
- **Build-time static edge composition** (bundle remotes into the host): breaks independent vertical deployment.
