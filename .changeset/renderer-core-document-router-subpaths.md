---
'@modern-js/renderer-core': minor
'@modern-js/renderer-solid': minor
'@modern-js/renderer-octane': minor
---

Move shared document and file-system route helpers into `@modern-js/renderer-core` so Solid and Octane use one implementation.

- **New subpaths:** `@modern-js/renderer-core/document` (document assets, inline data, bootstrap script, `prepareDocument`) and `@modern-js/renderer-core/router` (file-system route loading, route matching, `RouteDataError`).
- **Moved (breaking):** `collectDocumentAssets`, `serializeDocumentAsset`, `serializeInlineData` and the `DocumentAsset` type are no longer exported from `@modern-js/renderer-core/session`. Import them from `@modern-js/renderer-core/document`.
- **Removed (breaking):** the `InlineDataJSON` branded type from `@modern-js/renderer-core/data`. `serializePublicData` and `escapeInlineDataJSON` now return `string`.
- **Removed (breaking):** `resolveSolidModuleAsset` from `@modern-js/renderer-solid/manifest`. Use `validateSolidModuleManifest(manifest, identity, [key]).modules[key]`.
- **Removed (breaking):** `OCTANE_BOOTSTRAP_ID` from `@modern-js/renderer-octane/client`. Use `RENDERER_BOOTSTRAP_ID` from `@modern-js/renderer-core/document`.
