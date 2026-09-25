---
'@modern-js/app-tools-extensions': patch
---

Let Cloudflare worker bundles, including headless API-only workers, use every Node.js built-in that workerd provides under `nodejs_compat` (adding `console`, `diagnostics_channel`, `perf_hooks`, `querystring` and the rest of the probed set), externalize `cloudflare:sockets`, resolve `import`/`require` export conditions per dependency type so dual CommonJS/ESM packages such as `pg` bundle correctly, leave absent optional dependencies missing at runtime instead of failing the build (unless the app aliases or externalizes them), and reject a `deploy.worker.compatibilityDate` earlier than the 2026-06-02 date the built-in contract is verified against.
