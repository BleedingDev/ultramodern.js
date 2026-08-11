---
'@modern-js/create': patch
'@modern-js/code-tools': patch
'@modern-js/app-tools': patch
'@modern-js/builder': patch
'@modern-js/main-doc': patch
'@modern-js/plugin-bff': patch
'@modern-js/plugin-tanstack': patch
'@modern-js/render': patch
'@modern-js/runtime': patch
'@modern-js/utils': patch
---

Advance the UltraModern generator, Effect BFF lane, and TanStack integration to
the reviewed latest compatible runtime and toolchain cohort. Generated
workspaces now use Effect beta.107, the current TanStack and Module Federation
lines, Node 26.7 with pnpm 11.21, and the coherent stable Cloudflare v4 lane.
RSC remains disabled by default and is not shipped in the UltraModern company
distribution. The Rspack RSC toolchain is now an explicit optional peer of the
framework packages, while the patched upstream runtime is retained only as an
exact root development input for framework regression tests. Generated and
migrated applications receive neither an RSC runtime nor a consumer-side patch.
The Module Federation manifest-recovery runtime also keeps its retry timer on
the browser-safe universal utilities surface so client bundles never traverse
Node-only framework utilities. Production Effect BFF entries retain the native
module boundary established by their deployment build instead of being
re-bundled through the development source loader at server startup. Cloudflare
output verification now distinguishes bundled, lexically scoped loader calls
from actual external module imports while retaining fail-closed checks for
unprovided package edges.
