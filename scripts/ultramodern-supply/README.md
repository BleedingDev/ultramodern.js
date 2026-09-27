# Reproducible patch and sidecar inputs

`patch-inventory.ts` in the generator owns package/version, repository and workspace applicability, patch bytes' SHA-256 and purpose. `patches/` owns all patch bytes. `sync-patches.mjs --write` materializes the packaged copies, root pnpm configuration and patch ledger; its default mode checks all three and fails on missing, modified or unexpected packaged assets. Template assets remain committed for source and offline packaging; they are generated copies, never a second authoring location.

`sidecars.json` pins each upstream npm tarball URL and SHA-512, identity, license, artifact set and the only allowed manifest transformations. `ipx.patch` records the Sharp object-form remap and CLI version update.

The corrected dependency lane reconstructs the exact Module Federation and Effect artifacts named in the recipes during release staging. Only the recipes are kept in source control; authenticated upstream bytes, the canonical patches and the recorded dependency aliases produce the package contents and publication manifests. Unmodified Module Federation parents are included only where their published dependencies would otherwise resolve an uncorrected child. Effect 4.0.0-rc.117 is included so worker bundles receive its router without string code generation. Effect is the only qualified prerelease sidecar. Reconstructed third-party bytes are reported separately from authored code.

Run:

```sh
node scripts/ultramodern-supply/sync-patches.mjs
node scripts/ultramodern-supply/verify-sidecars.mjs
node scripts/ultramodern-supply/verify-sidecars.mjs --upstream-latest
node packages/sidecar/ipx/scripts/verify-sharpen.mjs
```

Verification downloads the exact pinned tarball, authenticates its bytes before extraction, and applies the integrity-checked patch with zero fuzz in an owned temporary directory. For the ipx sidecar it compares committed runtime artifacts byte for byte; for recipe-only sidecars it reconstructs the complete upstream artifact set and projects only the declared identity, repository and dependency changes. Temporary staging is always removed, including on failure. There is no pnpm-store discovery and no skip-on-missing path. Before verifying, the script resolves the recipe graph. Every `npm:@bleedingdev/<fork>@<version>` alias in a recipe or generator pin must name a recipe at that exact version. A recipe must carry a patch or non-alias manifest change, or reach one through its runtime, optional or peer aliases; otherwise it fails with `sidecar <id> has no patched descendant; delete recipe`. `sidecars.json` is also the only source of the publisher's consumer aliases (`<upstream name>` to `<fork name>`) and sidecar package roots; release-age exemptions follow from the staged sidecar manifest built from those roots.

`--upstream-latest` fetches the newest registry release of each patched recipe's major.minor (prereleases only for a prerelease pin), authenticates it against the packument integrity and dry-runs the patch in reverse with zero fuzz. It fails when a patch is already present upstream and lists the retirable recipes, including parents that no longer reach a correction, and the aliases the remaining recipes must drop. `.github/workflows/ultramodern-sidecar-retirement.yml` runs it weekly.

Offline verification accepts an explicit directory containing one `<recipe-id>.tgz` per recipe through `--artifacts <directory>`; the same pinned integrity checks apply. It does not need installed runtime dependencies. Behavioral scripts additionally require their normal dependencies.

## Release age

Every release lane (source acceptance, published acceptance, the Tractor rehearsal and published Tractor) passes pnpm the single set from `releaseAgeExemptions(manifest, policy)` in `scripts/ultramodern-production-readiness/published-create-proof/release-age-audit.mjs`: the cohort, the manifest's exact sidecar versions and reviewed exceptions. The pre-install audit rejects any lane whose set differs and names each immature package with its publish time and remaining wait. Third-party packages keep the 1440-minute gate.

Consumers that install outside these lanes keep the gate for sidecars. Publish a new or changed sidecar or fork version at least 24 hours before dispatching the cohort that pins it.

Update pins only after reviewing an exact upstream artifact and its license. Refresh patches with a deterministic diff against that artifact, then run reconstruction and behavioral verification. Reconstructed vendor bytes are not authored-code savings; no sidecar is retired without equivalent actual sharpening, CLI, exports and browser isolation.
