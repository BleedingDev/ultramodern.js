---
'@modern-js/ultramodern-create': patch
---

Regenerate migration lockfiles from a clean lock state inside the owned staged
workspace so the previous release cohort cannot be rejected against the new
release policy before pnpm has replaced it. The consumer lock remains protected
by the migration transaction and the generated lock still receives the full
release-age closure validation before commit.
