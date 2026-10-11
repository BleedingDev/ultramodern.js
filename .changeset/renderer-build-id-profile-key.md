---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/app-tools-extensions': patch
'@modern-js/renderer-octane': patch
---

Renderer builds no longer hash the source tree. Each build resolves one `buildId` from the renderer profile key (renderer, protocol version and installed renderer, framework and compiler versions), the lockfile and the git revision, or a per-process value for dev and dirty trees. `renderer-build.json` is now version 2: `{ renderer, profile, routerBindings, buildId, sourceRevision, entries }`. `serve` and the Cloudflare worker ask you to rebuild when it was made for another renderer or profile. The Rspack persistent build cache is on for every build, keyed by renderer and profile key, unless you set `performance.buildCache: false`. Octane module manifests drop `sourceSha256`, and the Octane source-provenance loader is removed.
