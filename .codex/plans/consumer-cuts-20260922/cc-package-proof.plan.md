---
name: cc-package-proof
overview: "Build and validate immutable candidate tarballs without consumer metadata, consumer framework patches, or generated command wrappers."
todos:
  - id: cc-package-proof-package-candidate
    content: "Prepare rehearsal tarballs and prove the complete corrected framework and sidecar dependency closure in clean consumers."
    status: in_progress
  - id: cc-package-proof-fresh-app-proof
    content: "Exercise newly generated UI and API-only workspaces on Node and Cloudflare using the packed packages."
    status: pending
isProject: false
---

# cc-package-proof

## Execution Notes

Use the existing release preparation/qualification commands for the candidate commit. Stage corrected sidecars and framework packages coherently in an isolated registry or the established strict package-consumer fixture. Do not overwrite .12 or publish a candidate before this gate passes. Feed authenticated packed bytes to consumers; do not qualify from workspace source aliases or locally mutated node_modules.

Generate fresh shell+UI and shell+API-only fixtures, install with no framework-required consumer patches, and confirm the obsolete JSON files/wrappers are absent. Invoke validation, typechecking, build, add-shell and add-vertical via installed CLI. Build Node deployment outputs and Cloudflare outputs/workerd proofs. Verify MF declaration generation, localized route loading and stable router identity, absence of lost app config, native API-only envelope binding and full-stack mismatch rejection. Reuse existing Linux/macOS/Windows paths for ESM and paths-with-spaces fixes.

Supply exact package identities, tarball checksums and retained bundle paths to cc-ontos and cc-tractor. Each isolated consumer run seeds its own loopback registry from that bundle using the existing `startEphemeralRegistry`/`withSourceCandidateRegistry` lifecycle. A registry started by an acceptance command is stopped when that command exits; do not hand a dead endpoint to the next owner or assume localhost works on another runner. This is existing release evidence, not a new application cohort file. Preserve cancellation/process cleanup behavior, and delete only temporary resources owned by this run.

This candidate proves the consumer adaptations. `cc-release` must freeze both workflow Tractor pins before the final producer. The workflow pin commit changes the framework source, so the final producer creates a new bundle at the chosen release version and repeats exact-artifact acceptance. Never label old-source receipts as evidence for new-source bytes.

## Constraints

Verification owner; writes only candidate artifacts, existing release test fixes within assigned ownership, and ignored output under the existing acceptance directories. No production semantics changes. Return any defect to its owning lane, then rebuild/requalify a new immutable candidate. No consumer edits or publication. Dependency package releases may require staged ordering; test that ordering before real publication.

## Operator Guidance

Depends on cc-integration. Stop after packed fresh consumers pass without prohibited files/patches and the exact same candidate is ready for both real downstream lanes. A failed required platform check blocks release; do not bypass hooks or weaken safety policy. Distinguish established unrelated baseline failures with evidence instead of silently treating them as new or passing them.
