---
name: Ultramodern Readiness 02 Effect HttpApi Contract Safety
overview: Make Effect HttpApi the strict default service boundary for generated UltraModern workspaces by proving contract-first type safety across shared API definition, backend implementation, frontend/service client usage, runtime schema validation, and generated add-flow services.
todos:
  - id: map-existing-effect-bff-capability
    content: Audit the existing Modern.js Effect BFF runtime, client helpers, generated UltraModern service files, and integration tests to separate already-implemented type-safety from generator-level gaps.
    status: completed
  - id: define-canonical-contract-location
    content: Decide the generated canonical contract location for services so shell, remotes, and service implementations import the same HttpApi definition instead of duplicating or hiding contracts under service-local paths.
    status: completed
  - id: generate-typed-client-usage
    content: Update the generated workspace design so at least one shell or remote imports the generated Effect HttpApi contract and calls the typed client with inferred request, response, and error types.
    status: completed
  - id: enforce-backend-contract-implementation
    content: Ensure generated service handlers use HttpApiBuilder against the shared contract so wrong handler names, request shapes, response shapes, or error channels fail typecheck.
    status: completed
  - id: add-negative-type-safety-tests
    content: Add focused type tests or fixture tests proving invalid client calls, invalid payloads, invalid params, invalid success responses, and invalid error responses fail at typecheck time.
    status: completed
  - id: add-runtime-schema-tests
    content: Add runtime tests proving HttpApi schema decoding rejects invalid boundary data and returns the expected Modern.js Effect BFF error behavior.
    status: completed
  - id: cover-add-flow-services
    content: Ensure every service generated through the MicroVertical add flow gets the same canonical contract, implementation, client import path, and validation coverage as the initial starter service.
    status: completed
  - id: update-docs-with-real-pattern
    content: Document the generated Effect HttpApi pattern as the default strict service-boundary approach, including where contracts live, how callers import clients, and which checks prove safety.
    status: completed
isProject: true
---

# Ultramodern Readiness 02 Effect HttpApi Contract Safety

## Execution Notes

Modern.js already contains serious Effect BFF primitives. `@modern-js/plugin-bff/effect-client` re-exports Effect HttpApi client building blocks, and `@modern-js/plugin-bff/effect-server` exposes `defineEffectBff` and `HttpApiBuilder`. The generated UltraModern service already uses `runtimeFramework: 'effect'`, defines an HttpApi contract, and implements it through `HttpApiBuilder`.

The gap is the generated SuperApp contract surface. The current generated workspace creates `packages/shared-effect-api/src/index.ts` as a loose placeholder while the actual HttpApi definition lives inside the generated service directory. That makes the starter less convincing as a strict shared service-boundary template. For ERP-like SuperApps, the default should be unmistakable: one shared HttpApi contract, backend implementation must satisfy it, callers use its inferred client, and both static and runtime checks prove the boundary.

## Constraints

- Use Modern.js Effect BFF and Effect HttpApi directly.
- Do not invent a custom RPC framework.
- Do not replace Effect HttpApi with Hono.
- Do not make OpenAPI the source of truth; OpenAPI is generated evidence.
- Keep the pattern domain-neutral. The sample can remain recommendations/demo data, but the contract structure must scale to real services.
- Avoid corporate certification metadata or ERP-specific service concepts.

## Operator Guidance

Begin with codebase research around these files:

- `packages/cli/plugin-bff/src/runtime/effect/index.ts`
- `packages/cli/plugin-bff/src/runtime/effect-client/index.ts`
- `packages/toolkit/create/src/ultramodern-workspace.ts`
- `tests/integration/bff-effect`
- `tests/integration/create-ultramodern-workspace`
- `tests/integration/routes-tanstack-mf`

The first implementation decision is contract location. Prefer a workspace package such as `packages/shared-effect-api` as the canonical contract source, because generated services already depend on it and callers can import it without reaching into a service directory. After that, make the generated service implementation import from that package, and add one generated caller that exercises the typed client.

The strongest acceptance signal is a test set that proves both sides:

- valid generated client usage typechecks and runs,
- invalid generated client usage fails typecheck,
- invalid backend handler implementation fails typecheck,
- invalid runtime payloads fail schema decoding,
- services added later by `--microvertical service` get the same guarantees.

## Processed Findings

The initial subagent-graph audit confirmed that Modern.js already has the important Effect HttpApi runtime pieces: `defineEffectBff` preserves the API type, `HttpApiBuilder` enforces backend handler shape, and the Effect client helpers support request execution, operation manifests, request context, and HttpApi client creation.

The UltraModern-specific gap is generator structure, not Modern.js capability. The generated service currently defines the real `HttpApi` in `services/<service>/shared/effect/api.ts`, while `packages/shared-effect-api` contains only placeholder interface/base-path metadata. That makes the generated workspace weaker than the intended SuperApp contract model.

Canonical decision: UltraModern generated workspaces should make `packages/shared-effect-api` the only contract source of truth. Generated services should import the real `recommendationsEffectApi` or service-specific `HttpApi` from that package. Do not generate service-local compatibility files for Effect API contracts.

Implementation slice completed:

- `packages/shared-effect-api` now owns the generated real `HttpApi` contract.
- The generated Effect service imports that package directly.
- No service-local `shared/effect/api.ts` compatibility shim is generated.
- The shell gets a small typed Effect HttpApi client helper using `makeEffectHttpApiClient` and `runEffectRequest`.
- `--microvertical service` appends the new service contract into `packages/shared-effect-api` and imports it from generated service code.

Final implementation slice completed:

- The generated canonical Effect HttpApi contract now exercises query, params, payload, success, and declared error schemas.
- Missing-resource handling uses schema-owned `TaggedErrorClass` errors and `new RecommendationNotFound({ id })`; generated code does not manually construct tagged error object literals.
- Generated service handlers cover list, get, and create through `HttpApiBuilder` against the shared contract.
- Generated shell client usage covers typed query, params, and payload calls through `makeEffectHttpApiClient`.
- Integration fixtures run native TypeScript against generated positive and negative client/backend contract cases.
- Plugin BFF runtime tests prove invalid payload data is rejected before handlers run and schema-owned typed errors map to declared HttpApi status.
- Template docs and scaffold validator describe and enforce the real pattern.
