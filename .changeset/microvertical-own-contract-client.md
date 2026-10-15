---
'@modern-js/code-tools': patch
'@modern-js/bff-effect': patch
---

A MicroVertical API client must now be built from its own API contract. Every `makeEffectHttpApiClient` call in the client's composed modules must receive an API proven to be built with `HttpApi.make` inside the contract package: the exported `<stem>Api` or an API it composes through `addHttpApi`, through aliases and `pipe(identity)`. Every `makeEffectRpcClient` call must receive the exported `<Stem>RpcGroup`. An API built elsewhere, supplied by a caller, or taken from another owner is a violation.

`makeEffectHttpApiClient` now sends `requestContext.operationContext` as the `x-operation-id` and `x-modernjs-bff-operation-context` headers that the Effect BFF server reads, and accepts a `headers` option for headers sent with every request. A wrapper factory is no longer needed to attach operation context or transport headers, so the boundary check only recognizes the native factories.
