---
'@modern-js/server-core': patch
---

server-core: `isResFinalized` now treats destroyed/closed responses as finalized (the null-safe `socket?.writable === false` check is kept), so middleware chains stop and `sendResponse` is skipped once a client aborts. HTTP/2 compat responses expose neither `destroyed` nor `closed`, so their liveness is read from `res.stream`; responses that never had a socket (mocks, worker runtimes) are still treated as live.
