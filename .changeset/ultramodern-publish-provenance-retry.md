---
'@modern-js/ultramodern-create': patch
---

Harden the BleedingDev UltraModern release flow around one immutable package
cohort: pack each tarball once, bind source qualification and ERP-10 acceptance
to the exact manifest identity, publish only the accepted bytes through trusted
OIDC, and reject registry, provenance, receipt, or release-identity drift.

Generated and migrated UltraModern workspaces now carry a structured validation
contract and an authenticated release-cohort projection derived from that exact
accepted manifest. Strict migration fails closed on unsafe registries, redirects,
malformed lockfile descriptors, unresolved dependency closure, or cohort alias
rebinding instead of silently preserving unverifiable release-age exemptions.
