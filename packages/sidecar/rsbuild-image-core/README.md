# @bleedingdev/rsbuild-image-core

UltraModern **sidecar repackage** of [`@rsbuild-image/core`](https://github.com/rspack-contrib/rsbuild-image)
`0.0.1-next.36`, published so that `@modern-js/image` ships hardened
`image-size` and Sharp floors to its consumers.

Upstream is MIT licensed, © 2025-present **Rspack Contrib**. The bundled
`LICENSE` is the upstream file byte-for-byte and all credit for the code in
`dist/` belongs to the upstream authors.

## Why this package exists

Dependency and peer ranges cannot be tightened by anything a consumer declares:
`pnpm` `overrides` are root-project-only and are *not* carried into a published
tarball. Upstream declares `image-size` as `^2.0.1`, which lets a consumer
lockfile keep 2.0.1 or 2.0.2 with the unbounded parser loops; 2.0.3 is the first
release that bounds them. Raising both floors for real consumers therefore means
republishing the package that owns those edges.

## What is different from upstream

This is a **dist-level repackage, not a source fork**. Only the published
artifact is available locally (there is no upstream source checkout), so every
byte under `dist/` is vendored verbatim and the entire delta lives in
`package.json`:

| Field | Upstream | Here |
| --- | --- | --- |
| `name` | `@rsbuild-image/core` | `@bleedingdev/rsbuild-image-core` |
| `version` | `0.0.1-next.36` | `0.1.4` |
| `dependencies["image-size"]` | `^2.0.1` | `^2.0.3` (hardened floor) |
| `devDependencies` | build/test toolchain | dropped (nothing is built here) |
| `peerDependencies.sharp` | `>=0.33.5` | `>=0.35.4` (patched floor) |

Everything else — `type`, `main`, `module`, `types`, the full five-subpath
`exports` map with all of its conditions, `typesVersions`, `sideEffects`,
`files`, peers other than Sharp, and `peerDependenciesMeta` — is copied verbatim.
`scripts/verify-manifest.mjs` checks that fidelity and the exact patched floors.

`0.1.4` is a **stable** semver version on purpose. `@rsbuild-image/react`
declares its peer on core as the wildcard `"*"`, which every resolver
short-circuits before semver, so the exact number is free; a stable one keeps
strict-peer consumers (npm, yarn classic) from ever having to opt into
prerelease matching.

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

Peers retain upstream requirements and optionality, except that Sharp requires
the patched 0.35.4 floor:

```
react      >=16.9.0   (required)
react-dom  >=16.9.0   (required)
sharp      >=0.35.4   (optional)
ipx        >=3.0.3    (optional)
```

Consumers using Sharp must resolve 0.35.4 or newer, even when their declared
range also permits an older version. Optionality remains unchanged; this does
not upgrade Sharp copies owned by other dependencies such as Miniflare.

## Verification

```sh
node packages/sidecar/rsbuild-image-core/scripts/verify-manifest.mjs
```

The verifier reconstructs the exact pinned upstream tarball and compares all runtime
bytes, manifest contracts and the MIT license, then checks browser isolation and
packed export targets. Missing upstream inputs and pack failures fail the check.
It never discovers or trusts an incidental pnpm-store copy. See the
[pinned recipes](../../../scripts/ultramodern-supply/README.md) for offline inputs.

## Re-vendoring

1. Copy `dist/` and `LICENSE` verbatim from the new upstream release.
2. Update the upstream URL/integrity, version and allowed manifest changes in
   `scripts/ultramodern-supply/sidecars.json`.
3. Re-apply the image-size and Sharp floors, then bump this package's version.
4. Run the verifier; it will flag any newly introduced self-reference,
   deep import, or Node dependency that leaked into `dist/shared/**`.
