---
'@modern-js/ultramodern-create': patch
'@modern-js/app-tools': patch
'@modern-js/plugin-bff': patch
---

Implement ADR-0019 federated loading, unified delivery: every UltraModern MicroVertical now derives its UI, API, and backend/server surface identity from a single delivery-unit record.

- `@modern-js/ultramodern-create` emits a per-vertical `deliveryUnit` identity root ({schemaVersion, kind, unitId, packageName, version, buildMarker, sourceRevision}) into the compact config, reference topology, backend federation contracts (`versionBoundary.identityRoot: 'deliveryUnit'`), the generated `shared/ultramodern-build.ts` (`ultramodernDeliveryUnit`), and expose compatibility metadata; the generated workspace validator and proof scripts assert identity-root equality across all surfaces and reject drifted markers.
- `@modern-js/app-tools` stamps the delivery-unit record into `backend-mf-manifest.json` (Node surface) and `modern-worker-manifest.json` (Cloudflare surface, including per-surface ui/api derivation) and fails the build/output verification closed on identity drift.
- `@modern-js/plugin-bff` backend federation runtime validates delivery-unit identity when loading federated Effect APIs and rejects mismatched unitId/build markers with typed `version_mismatch` errors carrying `failureEvent: 'modernjs:microvertical-server-fallback'` and structured details.

All changes are additive to the `microvertical-server-effect-v1` contract; legacy manifests and workspaces without delivery-unit metadata keep their existing behavior.
