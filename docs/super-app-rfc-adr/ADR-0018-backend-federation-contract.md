# ADR-0018: MicroVertical Server Execution Contract

- Status: Proposed
- Date: 2026-07-03
- Decision Type: Runtime federation contract
- Related:
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0003-effect-only-mf-data-fetch-reliability.md`
  - `ADR-0005-cross-project-bff-hardening.md`
  - `ADR-0017-superapp-composition-router-framework-coordination.md`
  - `ADR-0019-federated-loading-unified-delivery.md`
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

ADR-0019 governs MicroVertical delivery-unit identity. Cloudflare and Node `executionSurfaces` are platform surfaces for the same delivery unit, not independent promotion choices.

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

## Amendment 2026-07-10 — reconciliation with MicroVertical model v2

This amendment preserves the July 3 decision record. It supersedes only the
statements identified below, so that this ADR is read with the binding
vocabulary in `CONTEXT.md` and the evolution policy in ADR-0020.

### Superseded model statements

1. Section 1, lines 17-20, and Decision items 1-2 (lines 48-49) are
   superseded insofar as they require every vertical to have browser UI and a
   strict Effect API, or make `shell | vertical` the complete public model. A
   MicroVertical may be headless. Its published API Surface chooses one binding
   protocol — GraphQL, REST, or RPC — and the chosen protocol defines that
   surface's contract. A Shell and a Horizontal Remote are each their own
   Delivery Unit kind; a Horizontal Remote is not a frontend or backend half of
   a MicroVertical. `shell | vertical` may remain a legacy serialization during
   migration, but is not the canonical delivery-unit vocabulary.

2. Sections 3 and 6 are superseded wherever they make the strict Effect expose
   or Effect-specific metadata a universal requirement for every
   MicroVertical. They remain the contract for an Effect API Surface that opts
   into this server-execution adapter. Equivalent contract, readiness, client,
   observability, and validation requirements must be defined by the selected
   API protocol rather than inferred from Effect.

3. Section 5's `remoteType: 'commonjs-module'` example (line 175), and its
   statements that the current proof is CommonJS and ESM containers remain
   unproven (lines 181-185), are superseded. The current generator emits the
   Node execution-surface metadata with `remoteType: 'module'`
   (`packages/toolkit/ultramodern-create/src/ultramodern-workspace/backend-federation.ts:99-122`).
   That source evidence proves the generated contract selects an ESM remote; it
   does not prove that a generated Node adapter successfully loads that remote
   at runtime. The required missing proof is an executed Node adapter test that
   loads the generated ESM container and its declared expose. The historical
   CommonJS proof does not satisfy that ESM acceptance.

### Acceptance criteria after reconciliation

The following parts of Section 7 remain binding:

1. Criteria 1 and 2 remain binding as a shape rule whenever
   `backendFederation` is emitted: Cloudflare fields belong under
   `executionSurfaces.cloudflare`, Node Module Federation fields belong under
   `executionSurfaces.node`, and Node manifest/container fields must not leak
   into the Cloudflare/top-level contract.
2. Criterion 3 remains binding for the Cloudflare platform adapter: Worker SSR,
   asset and manifest behavior, and shell-to-vertical service-binding
   reachability require proof. Criterion 4 remains binding for the separate
   Node Module Federation platform adapter, including the ESM loading proof
   above. These are separate adapters and must not be collapsed into one shared
   URL loader.
3. Criterion 5 remains binding for typed, observable failure outcomes, and
   Criterion 7 remains binding for existing browser Module Federation SSR where
   a Delivery Unit publishes a UI surface. Criterion 8 remains binding for
   generator, runtime, or tooling changes.

The following parts are superseded or narrowed by `CONTEXT.md` and ADR-0020:

1. Criterion 1 no longer requires every MicroVertical to emit this contract;
   headless units and units without server execution are valid. Criterion 3's
   strict Effect readiness and UI/API-marker wording, Criterion 4's universal
   Effect expose wording, and Criterion 6's universal strict-Effect/raw-handler
   prohibition apply only to Effect API Surfaces. Other protocols require
   protocol-appropriate equivalents.
2. Criterion 5's unavailable-UI and strict-Effect-validation cases apply only
   to the corresponding published surface. Its version-mismatch requirement is
   superseded by the delivery-unit identity invariant: all applicable surfaces
   of one MicroVertical resolve from the same Delivery Unit, while a consumer
   supplies degraded-state handling during normal rollout skew.
3. No criterion creates a universal backward-compatibility obligation. Inside
   the Coordinated Zone, breaking changes update in-repository consumers in the
   same change; an Externally Published Surface follows semantic versioning and
   ships a breaking change as a new major alongside the previous major until
   known external consumers migrate, as ADR-0020 specifies.
