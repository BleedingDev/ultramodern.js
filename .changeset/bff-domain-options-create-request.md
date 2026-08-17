---
'@modern-js/bff-core': patch
'@modern-js/create-request': patch
---

Thread the configured BFF `domain` through generated clients and create-request. `generateClient` now emits an options-object call (path, method, port, httpMethodDecider, `domain` when configured, fetch shorthand, requestId, operationContext) instead of positional arguments, fixing the dropped-domain bug, and `create-request`'s browser runtime destructures `domain` into `resolveRequestUrl` with `configDomain || domain` precedence so a `setDomain`/`configure` override still wins.
