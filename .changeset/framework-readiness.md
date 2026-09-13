---
'@modern-js/server-core': patch
'@modern-js/server-runtime-extensions': patch
'@modern-js/plugin-bff-extensions': patch
---

Harden opt-in SSR caching with origin/query partitioning, credential-aware request bypass, response privacy checks, public-header replay and stale-entry eviction. Custom keys remain an application-owned partitioning contract.

Reject redirects when collecting remote federation CSS manifests. Apply one finite 10-second default deadline across backend manifest and entry loading, preserving explicit timeout configuration and zero opt-out.

Raise the optional Sharp peer floor to 0.35.4 and update compatible workspace dependency resolutions.
