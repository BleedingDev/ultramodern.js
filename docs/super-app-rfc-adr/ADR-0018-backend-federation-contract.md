# ADR-0018: MicroVertical Server Execution Contract

- Status: Proposed
- Date: 2026-07-03
- Decision Type: Runtime federation contract
- Related:
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0003-effect-only-mf-data-fetch-reliability.md`
  - `ADR-0005-cross-project-bff-hardening.md`
  - `ADR-0017-superapp-composition-router-framework-coordination.md`
  - `CLOUDFLARE-ZEPHYR-0001-ultramodern-worker-ssr.md`
  - `ZEROPS-0001-ultramodern-full-stack-node-proof.md`

## 1. Context

UltraModern generated workspaces keep the public model as `shell | vertical`.
A vertical is a full MicroVertical: browser UI, web Module Federation artifacts,
strict Effect API/BFF code, generated clients, topology metadata, and ownership
metadata in one versioned ownership unit.

The previous backend-federation draft overfit Cloudflare to Node-style backend
Module Federation: `backend-mf-manifest.json` plus `backendRemoteEntry.mjs`.
That is the wrong universal contract. Zephyr's current SSR Worker path is a
Cloudflare-only managed-integration snapshot model, and Cloudflare's native
worker-to-worker primitives are service bindings and Workers for Platforms
dispatch namespaces. Node can still use Module Federation runtime loading, but
that is a platform-specific execution surface, not the Cloudflare contract.

Sources checked July 3, 2026:

- Zephyr SSR Worker beta docs: <https://docs.zephyr-cloud.io/reference/ssr-worker>
- Zephyr TanStack Start docs: <https://docs.zephyr-cloud.io/meta-frameworks/tanstack-start>
- Cloudflare Service Bindings docs: <https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/>
- Cloudflare dynamic dispatch Worker docs: <https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/>

## 2. Decision

UltraModern will keep the generated contract name `backendFederation`, but its
meaning is a MicroVertical server-execution contract, not a universal backend
remote-container contract.

The contract belongs beside existing `moduleFederation` and `api` metadata in
generated topology, compact UltraModern config, and local overlays. It must:

1. Preserve the single `shell | vertical` public app model.
2. Identify the strict Effect API expose and readiness/openapi paths.
3. Record the UI/API version-boundary invariant: selected web MF build and
   selected Effect API build must describe the same MicroVertical build.
4. Put Cloudflare fields under `executionSurfaces.cloudflare`.
5. Put Node Module Federation runtime-loading fields under
   `executionSurfaces.node`.
6. Never expose Node backend manifest/container fields as top-level Cloudflare
   fields.

## 3. Contract Shape

Representative generated shape:

```ts
type BackendFederationContract = {
  role: 'microvertical-server';
  name: string;
  runtimeFramework: 'effect';
  strictEffectApproach: true;
  exposes: {
    './effect-api': {
      contract: string;
      runtime: string;
      client: string;
      openapi: string;
      readiness: string;
    };
  };
  versionBoundary: {
    invariant: 'web-and-api-same-build';
    packageName: string;
    ui: {
      manifestEnv: string;
      manifestUrl: string;
      buildMarker: string;
    };
    api: {
      readiness: string;
      buildMarker: string;
      publicUrlEnv: string;
    };
  };
  executionSurfaces: {
    cloudflare: CloudflareServerExecutionSurface;
    node: NodeServerExecutionSurface;
  };
  compatibility: {
    contractVersion: 'microvertical-server-effect-v1';
    packageName: string;
    effectVersion: string;
    moduleFederationVersion: string;
  };
  cache: {
    cloudflareSnapshot: 'immutable';
    nodeManifest: 'no-store';
    nodeVersionedContainer: 'immutable';
    nodeUnpinnedContainer: 'revalidate';
  };
  fallback: {
    timeoutMs: number;
    failureEvent: 'modernjs:microvertical-server-fallback';
    strategy: 'typed-effect-error';
  };
};
```

## 4. Cloudflare Surface

Cloudflare is modeled as full-stack Worker/snapshot execution:

```ts
type CloudflareServerExecutionSurface = {
  kind: 'cloudflare-worker-snapshot';
  workerName: string;
  publicUrlEnv: string;
  ssr: {
    workerEntry: '.output/server/index.mjs';
    workerManifest: '.output/server/modern-worker-manifest.json';
    routeManifest: '.output/server/route.json';
    ssrBundle: '.output/worker/index.js';
    effectBffBundle: '.output/worker/__modern_bff_effect.js';
    assetsBinding: 'ASSETS';
  };
  zephyr: {
    runtime: 'ssr-worker';
    integration: 'managed-cloudflare';
    snapshotIdEnv: string;
    versionIdEnv: string;
    applicationUidEnv: string;
  };
  workerDispatch: {
    preferred: 'service-binding';
    serviceBinding: string;
    serviceBindingEnv: string;
    dispatchNamespaceEnv: string;
    dispatchWorkerNameEnv: string;
    requestInterface: 'fetch';
  };
};
```

Generated shell Cloudflare configs declare `deploy.worker.services` entries
for vertical APIs. Modern.js writes Cloudflare-compatible `wrangler.json`
service bindings while keeping the API prefix in `modern-worker-manifest.json`,
then the module worker dispatches matching shell requests with
`env[binding].fetch(request)`.

Cloudflare proof must validate SSR, MF manifest, assets, strict Effect
readiness, UI/API build marker coupling, and shell-routed vertical API
readiness through service bindings. Live Zephyr snapshot switching remains
credential/public-URL gated until the proof harness can query real Zephyr
deployment metadata.

## 5. Node Surface

Node is modeled as a platform adapter that can use Module Federation runtime
loading:

```ts
type NodeServerExecutionSurface = {
  kind: 'node-mf-runtime';
  adapterVersion: 'backend-mf-effect-v1';
  remoteName: string;
  manifestEnv: string;
  manifestUrl: string;
  containerEntry: string;
  remoteType: 'commonjs-module';
  expose: './effect-api';
  runtimePackage: '@modern-js/plugin-bff/effect';
};
```

The generated `backend-federation.config.ts` and `api/effect-api.ts` are
framework-owned Node adapter artifacts. They are not a user-authored second
backend app/config. The current proof validates CommonJS backend remote loading
and a Worker-like `loadEntry` seam; ESM backend container support remains a Node
adapter risk until proven.

## 6. Effect Expose Rules

Only strict Effect API runtime exports are valid generated server exposes.
Allowed expose:

```ts
'./effect-api'
```

Required contents:

1. Effect `HttpApi` contract generated shared API module.
2. Branded `defineEffectBff(...)` runtime definition.
3. Readiness metadata route path.
4. OpenAPI metadata.
5. Generated client metadata for typed consumers.
6. Operation-context metadata for trace/policy checks.

Forbidden contents:

1. Raw `Request => Response` handlers.
2. Unbranded custom `createHandler` factories.
3. Hono server helper imports in generated UltraModern server execution paths.
4. Client-trusted authorization or tenant-scope shortcuts.
5. App-local wrappers that make a non-federated backend look federated.

## 7. Acceptance Criteria

Server execution work is not complete until all true:

1. Generated UltraModern verticals emit `backendFederation` metadata with
   `executionSurfaces.cloudflare` and `executionSurfaces.node`.
2. Generated tests prove Node manifest/container fields do not exist at the
   top level of `backendFederation`.
3. Cloudflare proof validates Worker SSR, web MF manifest, assets, strict Effect
   readiness, UI/API build marker coupling, and shell-to-vertical
   service-binding API reachability.
4. Node proof validates backend Effect expose loading through the Node adapter.
5. Failure modes are typed and observable: unavailable UI remote, unavailable
   worker/API, version mismatch, stale snapshot/manifest, timeout, unsupported
   runtime target, and strict Effect validation failure.
6. Generated validators reject non-strict or raw-handler server execution drift.
7. Existing browser MF SSR behavior remains intact.
8. Tractor Store downstream acceptance remains valid when generator/runtime/tooling
   changes land.
