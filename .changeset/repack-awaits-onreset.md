---
'@modern-js/server': patch
---

Await `onReset({ event: { type: 'repack' } })` handlers in dev before purging the previous server bundle from the require cache, and hold new requests until they settle. A slow async handler no longer races the next request that re-requires the bundle, and a rejecting handler is logged instead of surfacing as an unhandled rejection.
