# Release rollback runbook

For the `@bleedingdev/*` release train published by
`.github/workflows/publish-bleedingdev.yml`.

## Non-negotiable policy

- npm versions are immutable. A published `name@version` cannot be reused,
  even after unpublish; do not overwrite or republish the bad version.
- UltraModern publishes the full public cohort at dist-tag `latest`. The
  release CLI rejects `--packages`; a package-only republish is not a
  supported release-path operation.
- Trusted-publishing OIDC publishes package bytes but cannot mutate dist-tags.
  `ultramodern-canary` is retired. Do not restore it or repair `latest` with a
  tag flip.
- The only rollback is **deprecate-and-republish**: deprecate the bad version,
  cut a new `*-ultramodern.<revision>` version, and publish a corrected cohort.
  The new publication moves `latest` as part of the normal publish path.

## Authority and credentials

The current npm package/org owner executes registry mutations from an
interactive machine with 2FA. Use `command npm` for manual npm operations and
provide the current OTP when npm challenges or when passing `--otp`. Every
command that reads or mutates the registry pins
`--registry=https://registry.npmjs.org/`: trusted publishing requires the public
registry, and an executor's scoped `@bleedingdev:registry` config could
otherwise silently point the read or the deprecation elsewhere. The
corrected cohort itself must be published by the owner-triggered
`Publish BleedingDev Packages` workflow through trusted OIDC; do not replace
that path with a local token or an ad hoc `npm publish`.

## 1. Triage and record state

Set the exact package and versions; do not guess the current tag:

```bash
PACKAGE='@bleedingdev/<package>'
BAD_VERSION='<published bad version>'
GOOD_VERSION='<new ultramodern revision>'
DEPRECATION="Deprecated: use ${PACKAGE}@${GOOD_VERSION}; see the release incident."

command npm view "$PACKAGE" dist-tags --json --registry=https://registry.npmjs.org/
command npm view "$PACKAGE@$BAD_VERSION" dist --json --registry=https://registry.npmjs.org/
```

Record the output before changing the registry. Repeat for every affected
package.

## 2. Per-package incident

Deprecate only the affected package/version immediately:

```bash
OTP='<current six-digit OTP>'
command npm deprecate "$PACKAGE@$BAD_VERSION" "$DEPRECATION" \
  --otp "$OTP" --registry=https://registry.npmjs.org/
```

This is a **per-package deprecation**, not a package-only republish. Because
`--packages` is forbidden, request a corrected full-cohort release from the
release owner. Do not move `latest` manually.

## 3. Whole-train incident or corrected release

1. Deprecate each affected package at the bad version using the command above.
2. Cut the next unused `*-ultramodern.<revision>` version; never reuse
   `BAD_VERSION`.
3. Dispatch `Publish BleedingDev Packages` on `main-ultramodern` with that
   version. Run the workflow's `dry_run` first when time permits, then run the
   non-dry publication. The workflow validates the accepted artifacts and
   publishes the corrected full cohort at `latest` through OIDC.
4. Verify every package after publication:

```bash
for PACKAGE in '@bleedingdev/<package-a>' '@bleedingdev/<package-b>'; do
  command npm view "$PACKAGE" dist-tags --json --registry=https://registry.npmjs.org/
  command npm view "$PACKAGE@$GOOD_VERSION" dist --json --registry=https://registry.npmjs.org/
done
```

Expected result: each package has `latest` equal to `GOOD_VERSION`, and each
corrected `dist` record is present. If any package disagrees, stop and escalate
to the release owner; do not use `npm dist-tag` to force coherence.

## Evidence anchors

- Workflow tag, retired canary, OIDC limitation, and owner/branch gates:
  `.github/workflows/publish-bleedingdev.yml`
- Full-cohort and `--packages` prohibition:
  `scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/options.mjs`
- Registry inspection and trusted publication implementation:
  `scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/{registry,npm-buffer-publisher}.mjs`
- npm command syntax: `command npm help deprecate`, `command npm help publish`,
  `command npm help view`, and `command npm help dist-tag`.
