---
'@modern-js/app-tools-extensions': patch
---

Let Cloudflare worker bundles, including headless API-only workers, use every Node.js built-in that workerd provides under `nodejs_compat` (adding `console`, `diagnostics_channel`, `perf_hooks`, `querystring` and the rest of the probed set), externalize `cloudflare:sockets`, resolve `import`/`require` export conditions per dependency type so dual CommonJS/ESM packages such as `pg` bundle correctly, and leave absent optional dependencies missing at runtime instead of failing the build.
