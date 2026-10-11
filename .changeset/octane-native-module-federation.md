---
'@modern-js/renderer-octane': minor
'@modern-js/renderer-core': minor
'@modern-js/renderer-solid': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
'@modern-js/runtime-extensions': patch
'@modern-js/i18n-integration': patch
---

Add native Octane federated components for browser and Node SSR hosts, with an explicit application-owned federation instance, request-scoped loading, native Suspense recovery, streamed remote styles, shared router context and state-preserving hydration. Share the selected native package owners and the compiler's environment-specific runtime modules.

Serve the current completed Node federation container and its emitted dependencies during development, replace removed assets on rebuild, and reject stale compiler results before publishing them.

Generate and validate same-renderer Solid and Octane federation shells and remotes, preserve authored shell routes when adding a vertical, and emit the API artifacts advertised by native full-stack and headless packages. Native Worker federation remains unsupported until its transport and hydration ownership are implemented.

Bound native server remote downloads through the canonical Module Federation fetch hook, reject HTTP failures before evaluating the entry, and preserve retry after failed CJS or ESM loads. Correct the SDK hook dispatch and failed ESM module cache in authenticated dependency patches. Narrow runtime helper types to the hooks and configuration they consume so declaration builds accept the actual plugin APIs.
