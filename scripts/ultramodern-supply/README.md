# Reproducible patch and sidecar inputs

`patch-inventory.ts` in the generator owns package/version, repository and workspace applicability, patch bytes' SHA-256 and purpose. `patches/` owns all patch bytes, including the conditional Drizzle patch. `sync-patches.mjs --write` materializes the packaged copies, root pnpm configuration and patch ledger; its default mode checks all three and fails on missing, modified or unexpected packaged assets. Template assets remain committed for source and offline packaging; they are generated copies, never a second authoring location.

`sidecars.json` pins each upstream npm tarball URL and SHA-512, identity, license, artifact set and the only allowed manifest transformations. `ipx.patch` records the Sharp object-form remap and CLI version update. Rsbuild image core has no runtime patch; its manifest raises upstream image-size to the hardened `^2.0.3`, which bounds malformed parser loops. Its Sharp peer floor **remains >=0.35.4**.

The corrected dependency lane reconstructs the exact Module Federation, Effect, Zod and Drizzle artifacts named in the recipes during release staging. Only the recipes are kept in source control; authenticated upstream bytes, the canonical patches and the recorded dependency aliases produce the package contents and publication manifests. Unmodified Module Federation parents are included only where their published dependencies would otherwise resolve an uncorrected child. Effect 4.0.0-rc.117 is included so worker bundles receive its router without string code generation. Effect and Drizzle are the only qualified prerelease sidecars. Reconstructed third-party bytes are reported separately from authored code.

Run:

```sh
node scripts/ultramodern-supply/sync-patches.mjs
node scripts/ultramodern-supply/verify-sidecars.mjs
node packages/sidecar/ipx/scripts/verify-sharpen.mjs
node packages/sidecar/rsbuild-image-core/scripts/verify-manifest.mjs
```

Verification downloads the exact pinned tarball, authenticates its bytes before extraction, and applies the integrity-checked patch with zero fuzz in an owned temporary directory. For the two image sidecars it compares committed runtime artifacts byte for byte; for recipe-only sidecars it reconstructs the complete upstream artifact set and projects only the declared identity, repository and dependency changes. Temporary staging is always removed, including on failure. There is no pnpm-store discovery and no skip-on-missing path. Offline verification accepts an explicit directory containing one `<recipe-id>.tgz` per recipe through `--artifacts <directory>`; the same pinned integrity checks apply. It does not need installed runtime dependencies. Behavioral scripts additionally require their normal dependencies.

Update pins only after reviewing an exact upstream artifact and its license. Refresh patches with a deterministic diff against that artifact, then run reconstruction and behavioral verification. Reconstructed vendor bytes are not authored-code savings; no sidecar is retired without equivalent actual sharpening, CLI, exports and browser isolation.
