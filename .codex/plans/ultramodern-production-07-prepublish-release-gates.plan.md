---
name: ultramodern-production-07-prepublish-release-gates
overview: Move critical generated-template, security, and cohort-alignment checks before package publication so broken package sets are stopped before they become `latest`.
todos:
  - id: map-current-publish-gates
    content: Map `.github/workflows/publish-bleedingdev.yml`, `scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs`, `scripts/ultramodern-publish/validate-publish-security.mjs`, `scripts/security/validate-github-workflows.mjs`, and `scripts/release-gates` into a single pre-publish gate order with owners and failure messages.
    status: completed
  - id: add-source-generated-proof
    content: Add a pre-publish generated-template proof that runs from the current repository source before `npm publish`, verifying scaffold generation, install/check/build, cohort metadata, generated workflow contracts, and browser smoke without depending on already-published `latest`.
    status: completed
  - id: enforce-shared-version-policy
    content: Ensure pre-publish checks fail if public UltraModern packages, generated aliases, runtime dependencies, or create-package metadata violate the shared-version policy for the selected package cohort.
    status: completed
  - id: integrate-release-contract-evidence
    content: Connect release-candidate evidence requirements from `scripts/release-gates/README.md` and `rc-contract-profile.json` to the publish workflow so missing architecture, validation, test, review, commit, ticket, or workflow metadata blocks production release candidates.
    status: pending
  - id: harden-workflow-validation
    content: Extend workflow/security validation so sensitive publish and production-readiness workflows continue to ban token-based npm publishing, require trusted publishing posture, and validate generated starter/workspace workflow contracts.
    status: completed
  - id: attach-publish-artifacts
    content: Upload pre-publish proof artifacts, generated workspace summaries, security validation results, release-gate evidence, and package cohort manifests from the publish workflow for auditability.
    status: completed
  - id: test-failing-gate-scenarios
    content: Add tests or fixture-driven checks for failing source proof, package cohort mismatch, missing release evidence, insecure workflow edits, and invalid publish mode so gate failures are deterministic.
    status: completed
isProject: false
---

# Production Point 7: Pre-Publish Release Gates

## Research Basis

- `.github/workflows/publish-bleedingdev.yml` currently handles manual publish, package selection, build, security validation, and trusted publishing.
- `scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs` already encodes key shared-version behavior, including all-public-package selection when dependency version equals package version.
- `scripts/ultramodern-publish/validate-publish-security.mjs` validates trusted publish posture and rejects token-based publish patterns.
- `scripts/security/validate-github-workflows.mjs` validates sensitive workflow hardening and generated starter/workspace workflow contracts.
- `scripts/release-gates/README.md` and `rc-contract-profile.json` define release-candidate evidence expectations, but the current publish and post-publish production-readiness flows are still separate.

## Constraints

- Pre-publish generated proof must use local source/package output, not the current npm `latest`, otherwise it cannot stop the package set being published.
- Post-publish proof remains useful, but it should become confirmation rather than the first place a broken release is detected.
- Do not weaken trusted publishing or remote policy; default push/publish target remains the `bleedingdev` fork.

## Done Means

- Publishing cannot proceed until generated source proof, security workflow validation, shared-version checks, and required release evidence pass.
- Artifacts explain exactly what package cohort and generated workspace were certified.
- Post-publish production readiness remains aligned with the same contracts.
