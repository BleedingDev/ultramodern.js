---
'@modern-js/image-core-extensions': minor
'@modern-js/image': patch
---

Add a fork-owned, bounds-safe replacement for `@rsbuild-image/core` that
preserves its root, `shared`, and `types` public surfaces without shipping
vulnerable `image-size` internals.

Route `@modern-js/image` through that distributable implementation while
preserving the logical `@rsbuild-image/core` dependency key. Configure IPX
through its supported `assetPrefix` option at `/_modern/ipx` while preserving
an explicit consumer prefix.
