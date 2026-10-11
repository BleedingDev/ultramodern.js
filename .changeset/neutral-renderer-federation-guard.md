---
'@modern-js/federation-runtime': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
---

Publish finalized React renderer identities and exact compiler, runtime and bootstrap profiles in native Module Federation manifests. Validate them before native remote loading, including shared snapshot caches and conflicting loaded runtime factories. Keep React distributed SSR behind its dedicated public entry and generate consumers against that entry.
