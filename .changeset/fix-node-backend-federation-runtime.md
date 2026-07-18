---
'@modern-js/app-tools': patch
'@modern-js/create': patch
'@modern-js/plugin-bff': patch
'@modern-js/plugin-i18n': patch
'@modern-js/runtime': patch
'@modern-js/server-core': patch
'@modern-js/server-runtime-extensions': patch
'@modern-js/utils': patch
---

Emit Node backend federation containers as bundled CommonJS modules and load
their live HTTP manifests through the official Module Federation runtime.
Generated UltraModern proofs no longer replace remote URLs with local file
URLs, and backend manifests and containers bypass locale redirects and receive
the framework Module Federation cache policy.

Keep server-side frontend federation alive across transient HTTP manifest
outages with a bounded Modern.js runtime recovery plugin. Typed manifest schema,
identity, version, remote-entry, and factory failures remain owned by Module
Federation and are never converted into retries or successful responses.

Bind each full-stack MicroVertical's UI, SSR, Effect API/backend, backend
federation manifest, and backend federation container into one target-specific
release envelope. Node deployment reseals generated `dist/public` assets before
staging, while Cloudflare generates them in the target build directory,
flattens them into Worker Static Assets, and emits the final staged envelope
only after all executable and public bytes exist. The generated public-surface
CLI exposes that predeploy location explicitly as `cloudflare-dist`; it never
silently redirects `dist` based on environment variables.

Serve post-build Node public-surface files such as `robots.txt`, `sitemap.xml`,
and `site.webmanifest` from a traversal-safe `dist/public` fallback even when
they were generated after `route.json`. Cloudflare verification remains
read-only and can no longer bless mutations made after deployment staging.

Keep generated and migrated Cloudflare build scripts on the same fail-closed
output-verification contract, and make generated command wrappers report
process-launch failures before exiting nonzero.

Expose each generated application's Cloudflare smoke contract through compact
topology metadata so the real workerd proof executes SSR, API, backend
federation, and service-binding composition instead of accepting missing
runtime checks.
