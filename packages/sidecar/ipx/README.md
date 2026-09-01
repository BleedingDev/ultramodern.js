# @bleedingdev/ipx

A minimal, distributable sidecar fork of [`ipx`](https://github.com/unjs/ipx) — "High
performance, secure and easy-to-use image optimizer" — by Pooya Parsa and the UnJS
contributors, MIT licensed. The upstream `LICENSE` is preserved verbatim next to this file.

Forked from **`ipx@3.1.1`**. Published as **`@bleedingdev/ipx@3.2.0`**.

The `dist/` tree here is the upstream published build, vendored byte-for-byte except for the
hunks listed below. Upstream ships no TypeScript sources in the npm tarball, so this fork
patches the published chunks directly rather than rebuilding from source; that keeps the diff
against `ipx@3.1.1` small enough to re-audit by eye on every upstream bump.

## Why this fork exists

`@modern-js/image` depends on `sharp@^0.35.3`, but `ipx@3.1.1` declares `"sharp": "^0.34.3"`
as a **plain dependency**. A `0.x` caret does not admit `0.35.x`
(`semver.satisfies("0.35.3", "^0.34.3") === false`), so every consumer of the published
`@modern-js/image` also installs a second, older `sharp` — currently `sharp@0.34.5` — behind
IPX. Plain dependencies cannot be redirected from a consumer's manifest: `pnpm.overrides` and
`pnpm.patchedDependencies` apply only to the root project and are not carried into a published
package. Forking the dependency and aliasing it in `@modern-js/image` is the only distributable
fix.

The version is a **stable** `3.2.0` on purpose. Both `@rsbuild-image/core` and
`@rsbuild-image/react` declare the peer range `"ipx": ">=3.0.3"`, and npm evaluates non-wildcard
peer ranges with a loose-only `semver.satisfies` that **excludes prereleases**. A prerelease
version such as `3.2.0-ultramodern.1` would pass pnpm but fail strict npm and yarn-classic
consumers.

## Fork delta vs `ipx@3.1.1`

### 1. `sharp` dependency range: `^0.34.3` → `^0.35.3` (`package.json`)

Aligns IPX with the `sharp` version `@modern-js/image` already declares, so a single, current
`sharp` is installed for the whole image pipeline.

### 2. `sharpen` modifier remapped to Sharp 0.35's object form (`dist/shared/*`, 2 hunks)

Sharp 0.35 **removed** the deprecated positional `sharpen(sigma, flat, jagged)` signature. Its
replacement (`sharp/dist/operation.cjs`, `function sharpen (options)`) reads a plain object and
falls through to `this.options.sharpenSigma = -1` — the "mild sharpen" default — for **any**
non-object argument. Upstream's call therefore does not throw under Sharp 0.35; it *silently
discards every parameter the user asked for*.

Upstream (`dist/shared/ipx.CXJeaylD.mjs:213-217` and `dist/shared/ipx.GUc23orS.cjs:220-224`):

```js
apply: (_context, pipe, sigma, flat, jagged) => {
  return pipe.sharpen(sigma, flat, jagged);
}
```

This fork maps the IPX modifier arguments onto `{ sigma, m1, m2 }`, coercing each to a number
(IPX arguments arrive through `VArg`, i.e. `destr`, so a URL segment may still be a string) and
treating `undefined`, `null`, an empty segment, and a non-numeric segment as "absent" — which
yields Sharp's argument-less mild sharpen instead of a thrown parameter error. `NaN` is never
handed to Sharp.

Behaviour notes:

- `?sharpen` (bare, no value) now applies Sharp's mild sharpen. Under `ipx@3.1.1` + `sharp@0.34`
  this threw `Expected number between 0.01 and 10000 for sigma`; the new behaviour matches
  Sharp's own no-argument contract and IPX's convention that a bare modifier is a flag.
- The accepted `sigma` range narrows from Sharp 0.34's deprecated positional range
  (`0.01`–`10000`) to Sharp 0.35's object-form range (`0.000001`–`10`). This is an upstream Sharp
  restriction, not a fork decision; out-of-range values raise Sharp's own parameter error rather
  than being silently clamped.
- `flat`/`jagged` map to `m1`/`m2`, whose valid range widens to `0`–`1000000` (Sharp 0.34's
  deprecated path capped them at `10000`).

### 3. CLI banner version string `3.1.1` → `3.2.0` (`dist/cli.mjs`, `dist/cli.cjs`)

Cosmetic and non-functional: the version is inlined into the published CLI at build time, so
without this hunk `ipx --version` would disagree with this package's manifest. The bin name
itself is unchanged (`"bin": "./bin/ipx.mjs"` in string form, which
`npm-normalize-package-bin` resolves to the basename `ipx`), so the `ipx` CLI contract is
preserved despite the scoped package name.

## Sharp 0.34 → 0.35 audit (no other remaps required)

Every Sharp method IPX's modifier table reaches was compared between `sharp@0.34.5`
(`lib/*.js`) and `sharp@0.35.3` (`dist/*.cjs`): `resize`, `trim`, `extend`, `extract`, `rotate`,
`flip`, `flop`, `sharpen`, `median`, `blur`, `flatten`, `gamma`, `negate`, `normalize`,
`threshold`, `modulate`, `tint`, `grayscale`, plus the pipeline's `toFormat` and `toBuffer`.

- **`sharpen` is the only removal.** Everything else is byte-identical or differs only in added
  upper-bound validation (`extend` now rejects > 10000 px per edge; `extract` now rejects
  > 100000000; `trim` gained an optional `margin` option). None of those changes reject an input
  that `ipx@3.1.1` previously produced valid output for.
- The `trim` modifier passes a bare number to `sharp.trim()`, which throws
  `Expected object for trim`. That is a **pre-existing upstream IPX bug**, identical under Sharp
  0.34.5 and 0.35.3, and is deliberately left unchanged here so this fork stays a
  security/compatibility fork rather than a behaviour fork.

## Verification

`scripts/verify-sharpen.mjs` exercises the remap end-to-end against a real image through
`createIPX` + `ipxFSStorage` and asserts that `sigma`, `flat` and `jagged` actually reach
libvips (different values must produce different bytes). Run it from a checkout where the
runtime dependencies resolve:

```sh
node packages/sidecar/ipx/scripts/verify-sharpen.mjs [imageDir]
```

Running the same script against the unpatched `ipx@3.1.1` dist on `sharp@0.35.3` fails both
differentiation assertions — every `sharpen` variant returns the identical mild-sharpen buffer —
which is exactly the silent regression this fork removes.

## Maintenance

On an upstream `ipx` release, re-vendor `bin/`, `dist/` and `LICENSE`, then re-apply the hunks in
"Fork delta" (or drop them if upstream has adopted Sharp 0.35). `diff -ru` against the upstream
tarball must show those hunks and nothing else.
