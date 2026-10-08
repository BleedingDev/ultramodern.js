---
name: Dependency refresh release acceptance
overview: Qualify the integrated graph through repository packed-consumer and downstream acceptance before promoting one complete framework release.
todos:
  - id: pass-integrated-quality-gates
    content: Pass all required build lint type framework builder supply boundary and security gates on the final frozen dependency graph.
    status: in_progress
  - id: qualify-packed-release
    content: Validate one release cohort with independent packed installs and mandatory Tractor acceptance when the downstream demo exists.
    status: pending
  - id: prepare-one-release-handoff
    content: Add the coordinated changeset and final version/security evidence and stage one reviewed release promotion with whole-cohort rollback instructions.
    status: pending
isProject: false
---

# Dependency refresh release acceptance

## Execution Notes

Beads `modernjs-h8xqq.7`. Depends on generator integration and tooling. Own final release evidence, changeset, version preparation and downstream acceptance records. The dependency refresh ships in the next version of the existing UltraModern stream. All released first-party framework packages and generator pins derive from one source commit and one release-cohort projection; corrected third-party artifacts retain their own reviewed upstream version identities.

Check whether `/Users/satan/side/experiments/tractor-store-vertical` exists. If present, update it through supported framework packages and validate its real install/build/type/tests, navigation/prefetch, SSR/hydration, localization, federated composition, API calls and Node/Worker delivery as applicable. Preserve its visible Tractor UI. If absent, record the check and qualify equivalent freshly generated consumers. Application shims or manual generated-file edits cannot count as acceptance.

## Constraints

One public version after every required lane passes. No public partial-framework releases. No unconditional npm publish in this plan: package publication requires explicit user authorization for the concrete qualified release. Push work to `bleedingdev`, never upstream `origin` without authorization. Corrected-artifact publication may be an operational prerequisite to independent consumer proof and must be authorized before execution; delay framework promotion until all packages are available and eligible for release-age checks.

## Operator Guidance

Run `pnpm check-dependencies`, `pnpm lint:package-json`, changed-source lint, `pnpm build:required`, `pnpm validate:tsgo`, `pnpm test:ut`, `pnpm test:framework`, `pnpm test:builder`, `pnpm test:scripts`, `pnpm test:publish-tooling`, `pnpm test:build-consumers:release`, skill regressions, `pnpm validate:boundary-check`, `pnpm validate:supply`, MF contracts and release superapp certification. Use current exact scripts verified in the target branch; do not use the failure-masking prepare-build-continue command as proof. Consult fresh TraceDecay diagnostics before compiler gates. Build docs and verify exports, browser isolation, declarations and native compiler paths.

For upstream-owned edits, record same-PR `FORK-DIVERGENCE.md` owner/reason/disposition evidence and run the canonical gate against `eded841256`. Any allowed growth is recorded with the explicit reviewed merge-base/head operation, not a changed scope or stale budget. A genuine componentwise shrink needs no ledger ceremony.

Stage packs with the existing bleedingdev publication tooling. Independently install from packs or approved candidate artifacts without workspace links. Verify exact aliases/cohort versions, no duplicated platform singletons, no missing peers, no accidental secret/environment files, and runtime HTTP/RPC/Worker/MF behavior. Re-run repository and packed-consumer audits; fixed high/moderate advisories must disappear, and remaining findings need owner, reachability evidence and an explicit release disposition. Compare install/bundle baselines and investigate material regressions.

Prepare one coordinated changeset and release summary with target versions, correction retirements, exceptions, security outcomes and gates. Rollback restores the previous complete framework version, dependency locks, recipes and generated toolchain contract. Update and close Beads tasks only as completed. If a PR is requested, use the repository's visual-pr/show-me format and register its URL with this thread. No review nudges.
