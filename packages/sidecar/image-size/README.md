# @bleedingdev/image-size

A sidecar fork of [`image-size`](https://github.com/image-size/image-size) published by the
UltraModern.js fork so that the image parser hardening reaches **published consumers**, not just
this monorepo's own installs.

## Provenance

- **Upstream**: `image-size@2.0.2` — MIT, © netroy \<aditya@netroy.in\>. The upstream `LICENSE` is
  vendored verbatim alongside this file.
- **Vendored artifact**: the upstream published `dist/` and `bin/image-size.js`, byte-for-byte, with
  the delta below already applied.

## The delta — and nothing else

The **only** difference from upstream `2.0.2` is the parser denial-of-service hardening from
upstream [image-size PR #459](https://github.com/image-size/image-size/pull/459), pre-applied to the
distributed `dist/`. No other source change, no added dependency, no behavioural change to valid
image parsing.

That hardening covers the ISO-BMFF-family and JPEG parsers:

- `readBox` requires a full 8-byte box header (`MIN_BOX_HEADER`) before reading, and special-cases
  the `boxSize === 0` (box extends to end of input) and `boxSize === 1` (64-bit extended size,
  unsupported → reject) encodings instead of trusting the 32-bit size field.
- `findBox` advances by an explicitly computed `nextOffset` and breaks when `nextOffset <= offset`,
  so a zero-or-negative advance can no longer spin forever on attacker-chosen bytes.
- ICNS entries are bounded by `MIN_ENTRY_LENGTH`, and JPEG rejects segments whose declared length
  cannot contain their own length field (`Corrupt JPG, invalid segment length`).

Net effect: malformed HEIF/AVIF, ICNS, JXL, JP2 and JPEG inputs are **rejected in bounded time**
rather than driving an unbounded parse loop. Valid images of every supported format parse exactly as
they do upstream.

### Why a fork rather than a patch

`image-size` reaches this project as a plain, transitive dependency of `@rsbuild-image/core`. Plain
dependencies cannot be redirected by anything a consumer declares, and pnpm `patchedDependencies` /
npm `overrides` apply only to the root project — so neither is distributable. Republishing the
hardened distribution under a fork name, and aliasing it from the fork of `@rsbuild-image/core`, is
what makes the fix reach installs of the published packages.

## Versioning

`2.1.0` — a stable (non-prerelease) minor over upstream `2.0.2`, signalling the hardening delta while
staying trivially comparable to the upstream line. A stable version is required: prerelease versions
are excluded by npm's loose `semver.satisfies` when strict peer ranges are evaluated downstream.

## API

Identical to upstream `image-size@2.0.2`: same entry points, the same three export subpaths
(`.`, `./fromFile`, `./types/*`), the same `image-size` CLI binary, the same zero runtime
dependencies, and the same `node >=16.x` engine range.

## Verification

`node scripts/verify-security.mjs` replays the malicious HEIF / ICNS / JXL / JP2 / JPEG inputs plus a
valid-image regression per format against **this directory's own `dist/`**, over both the CommonJS
and the ES-module entry points, under a wall-clock budget. It resolves the distribution by absolute
path rather than through the monorepo's resolution chain, so a pass proves the published artifact is
hardened on its own — independent of any repo-level patching.
