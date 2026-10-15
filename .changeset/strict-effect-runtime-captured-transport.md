---
'@modern-js/code-tools': patch
---

The strict Effect runtime check now treats a write through `const alias = value` as a write to `value`, so a mutated alias of `Layer` or another trusted import fails closed. Transport layers may also register literal `HttpRouter.add(method, path, handler)` routes, and a route that captures a service through `Layer.unwrap(Service.pipe(Effect.map(service => HttpRouter.add(...))))` is accepted when the transport explicitly provides that service with `Layer.provide`.
