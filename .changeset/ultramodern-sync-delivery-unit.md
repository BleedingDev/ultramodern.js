---
'@modern-js/ultramodern-create': patch
---

Add `ultramodern sync-delivery-unit` tooling command: backfills ADR-0019 delivery-unit identity blocks (topology entries, backendFederation contracts, `versionBoundary.identityRoot`, and regenerated `shared/ultramodern-build.ts`) into existing generated workspaces in place, so downstream workspaces created before the delivery-unit identity root can pass the fail-closed workspace validator without re-scaffolding. Idempotent; writes only the three identity target sets and refuses to run without `.modernjs/ultramodern.json`.
