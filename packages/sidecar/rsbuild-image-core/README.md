# @bleedingdev/rsbuild-image-core

UltraModern **sidecar repackage** of [`@rsbuild-image/core`](https://github.com/rspack-contrib/rsbuild-image)
`0.0.1-next.36`, published so that `@modern-js/image` can ship a hardened
`image-size` to its consumers.

Upstream is MIT licensed, © 2025-present **Rspack Contrib**. The bundled
`LICENSE` is the upstream file byte-for-byte and all credit for the code in
`dist/` belongs to the upstream authors.

## Why this package exists

`@rsbuild-image/core` declares `image-size` as a **plain dependency**. Plain
dependencies cannot be redirected by anything a consumer declares: `pnpm`
`overrides` and `patchedDependencies` are root-project-only and are *not*
carried into a published tarball, so a fix applied in this monorepo would never
reach anyone who installs `@modern-js/image` from npm.

`image-size@2.0.2` carries a parser denial-of-service that upstream fixed in
PR 459. To ship that fix to real consumers, the dependency edge itself has to
change — which means republishing the package that owns the edge.

## What is different from upstream

This is a **dist-level repackage, not a source fork**. Only the published
artifact is available locally (there is no upstream source checkout), so every
byte under `dist/` is vendored verbatim and the entire delta lives in
`package.json`:

| Field | Upstream | Here |
| --- | --- | --- |
| `name` | `@rsbuild-image/core` | `@bleedingdev/rsbuild-image-core` |
| `version` | `0.0.1-next.36` | `0.1.0` |
| `dependencies["image-size"]` | `^2.0.1` | `npm:@bleedingdev/image-size@2.1.0` |
| `devDependencies` | build/test toolchain | dropped (nothing is built here) |

Everything else — `type`, `main`, `module`, `types`, the full five-subpath
`exports` map with all of its conditions, `typesVersions`, `sideEffects`,
`files`, `peerDependencies`, `peerDependenciesMeta` — is copied verbatim and is
asserted byte-equal by `scripts/verify-manifest.mjs`.

`0.1.0` is a **stable** semver version on purpose. `@rsbuild-image/react`
declares its peer on core as the wildcard `"*"`, which every resolver
short-circuits before semver, so the exact number is free; a stable one keeps
strict-peer consumers (npm, yarn classic) from ever having to opt into
prerelease matching.

### `image-size` is redirected without touching a single dist byte

The alias keeps the **install name** `image-size`, so the compiled

```js
import * as … from "image-size";      // dist/image.mjs:1
const … = require("image-size");      // dist/image.js:48
```

resolve to `@bleedingdev/image-size@2.1.0` with zero rewrites. Those two lines
are the only places `image-size` appears in the whole bundle, and both use the
bare specifier — no deep or file-path import can bypass the alias.

### Self-reference audit (no dist rewrites were required)

Under the rename, Node and TypeScript resolve a package's *self-reference* via
the manifest `name` field, so a bare `@rsbuild-image/core` **import specifier**
inside `dist/` would stop resolving in this fork's own context. The vendored
bundle was audited and contains **zero such specifiers**. The nine literal
occurrences that do exist are all non-specifiers, and every one of them must
keep the old name:

| Location | What it is |
| --- | --- |
| `dist/env.d.ts:6` | ambient `declare module '@rsbuild-image/core/types'` — consumers (`plugin-image/src/types.ts:1`) import that exact specifier, resolved through the alias install directory |
| `dist/plugin.js:121`, `dist/plugin.mjs:65` | the rsbuild plugin's `name:` string |
| `dist/plugin.js:141`, `dist/plugin.mjs:85` | an rspack `resolve.alias` **key**, `'@rsbuild-image/core/image-loader'` — `@rsbuild-image/react`'s dist imports that literal specifier, so renaming it would break the loader override |
| `dist/shared/constants.{d.ts,js,mjs}` | the `PACKAGE_NAME` constant, used only in a debug log line (`dist/loader.mjs:43`) |
| `dist/shared/types/image.d.ts:28` | a JSDoc `@default` tag inside a comment |

Because the package is installed as `node_modules/@rsbuild-image/core` (the
alias directory name), `@rsbuild-image/react`'s bare imports of
`@rsbuild-image/core`, `@rsbuild-image/core/shared` and
`@rsbuild-image/core/image-loader` continue to resolve here. **All five export
subpaths must be preserved** or React breaks at runtime.

### Node-only code stays dynamic; the shared surface stays browser-safe

* `ipx` is reached only through `import("ipx")` in `dist/plugin.{js,mjs}`.
* `sharp` is reached only through `import("sharp")` in `dist/image.{js,mjs}`.
* `dist/shared/**` — which backs both the `./shared` and `./image-loader`
  export subpaths, the surface that ends up in browser and Worker bundles —
  imports nothing but `ufo` and relative siblings: no `node:` builtins, no
  `ipx`, no `sharp`, no `image-size`.

All three properties are asserted by the verifier, so a future re-vendor cannot
silently leak a Node dependency into the edge bundle.

## Peer dependencies

`peerDependencies` and `peerDependenciesMeta` are copied verbatim and are
deliberately **not** "improved":

```
react      >=16.9.0   (required)
react-dom  >=16.9.0   (required)
sharp      >=0.33.5   (optional)
ipx        >=3.0.3    (optional)
```

`@modern-js/image` supplies `sharp@^0.35.3` and
`ipx: npm:@bleedingdev/ipx@3.2.0`; both satisfy these ranges under pnpm and
under npm's stricter, prerelease-excluding check. Making `react` optional would
be a product decision that belongs to the fork owner, not to this repackage.

## Verification

```sh
node packages/sidecar/rsbuild-image-core/scripts/verify-manifest.mjs
```

No install and no network required. The script asserts manifest identity,
byte-equal dependency ranges, deep-equal `exports`/peers, on-disk existence of
every export target, the specifier audits described above, a byte-identical
`diff -ru` against the upstream copy in the pnpm store (skipped when it is not
installed), and that `npm pack --dry-run` ships every export subpath target.

## Re-vendoring

1. Copy `dist/` and `LICENSE` verbatim from the new upstream release.
2. Update `UPSTREAM_VERSION` and the `UPSTREAM_SNAPSHOT` literal in
   `scripts/verify-manifest.mjs`.
3. Re-apply the single `image-size` alias and bump this package's version.
4. Run the verifier; it will flag any newly introduced self-reference,
   deep import, or Node dependency that leaked into `dist/shared/**`.
