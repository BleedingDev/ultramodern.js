---
'@modern-js/plugin-tanstack': patch
'@modern-js/ultramodern-create': patch
---

`routes-generate` now writes `src/routes/ultramodern-route-metadata.ts` from the
app's `route.meta.ts` files. The manifest is already formatted, and it is written
before the app config loads. This means a manifest that still imports a deleted
route cannot block its own regeneration. Generated app `dev` and `build` scripts
run `routes-generate --manifest-only` in place of
`public-surface --sync-route-metadata`, which has been removed. Manifest-only
mode never loads the app config. Every `route.meta.ts` must export `routeMeta`. If the last
`route.meta.ts` is deleted while the generated manifest remains, generation
fails with an error that names the fix.
