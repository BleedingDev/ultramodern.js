---
'@modern-js/ultramodern-create': patch
---

Route release-age registry metadata the same way the published-create proof
audit does: only packuments in the cohort scope come from the package-source
registry, every other dependency is validated against npmjs. A source-mode
release rehearsal that passes its loopback ephemeral registry no longer fails
on the first third-party candidate, and a loopback HTTP registry is accepted
for that scope while non-loopback registries still require HTTPS.
