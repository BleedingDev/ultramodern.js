---
'@modern-js/ultramodern-create': minor
'@modern-js/app-tools-extensions': patch
'@modern-js/code-tools': patch
'@modern-js/bff-effect': patch
'@modern-js/plugin-bff-extensions': patch
'@modern-js/server-runtime-extensions': patch
---

Use native workspace topology, application manifests and pnpm catalogs instead of copied framework metadata, consumer patch sets and generated CLI forwarders. Preserve authored configuration and delivery identity in generation, validation and add operations.

Emit native API-only release envelopes and validate their real artifacts. Resolve shared API imports through package exports while retaining private-boundary checks and bounded analysis.

Keep bundled RPC handlers in their native Effect runtime and preserve host request validation. Verify RPC with the app's public client, and verify headless Cloudflare workers in standalone and mixed workspaces with multiple shells.
