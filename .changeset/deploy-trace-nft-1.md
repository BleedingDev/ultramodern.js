---
'@modern-js/app-tools': patch
---

Trace Node, Netlify and Vercel deploy output with `@vercel/nft` 1.x instead
of the 0.29.2 release ndepe pins, and stop the trace from globbing the build
host: dynamic paths under `/dev`, `/proc`, `/sys`, `/etc`, `/run` and
`/var/run`, and globs of the whole file system root, home or temp directory,
are ignored.
