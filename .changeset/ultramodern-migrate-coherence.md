---
'@modern-js/ultramodern-create': patch
---

Make `ultramodern migrate-strict-effect` converge a workspace to the same end
state the validator contract requires. Migrate now materializes every
validator-required workspace-owned script and tool wrapper (agent skills
bootstrap, reference-repo installer, i18n/API boundary checks,
performance-readiness config) instead of only refreshing tool wrappers, so the
stock `contract:check` stays satisfiable after an upgrade. Backend-federation
and Zerops surfaces are gated on the workspace actually exposing API-bearing
verticals: shell-only workspaces no longer get `node:proof`,
`node:backend-federation:generate`, or `zerops:materialize` injected (and the
generated validator no longer requires those artifacts). Consumer-owned
`package.json` script entries are preserved — the curated `check` aggregate is
merged rather than replaced. Emitted tool wrappers are single-quoted so they
pass the scaffold's `singleQuote` oxfmt config, every renamed `.mjs` script has
its `package.json` references rewritten to the successor `.mts`, the compact
config's `generator.version` is kept consistent with the migrated package
version.
