---
'@modern-js/ultramodern-create': patch
---

Patch generated workspaces' exact `msgpackr@2.0.6` dependency to remove its
dynamic record-reader constructor while retaining the ordinary decoder, and
patch `zod@4.4.3` so its published ESM and CommonJS entries skip the runtime
`Function` capability probe. The root workspace and generated templates carry
identical patches so strict CSP and Worker builds do not depend on runtime code
generation.
