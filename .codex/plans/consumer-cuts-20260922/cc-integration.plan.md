---
name: cc-integration
overview: "Integrate the four implementation lanes, remove central patch policy and duplicated template state, and qualify one coherent source candidate."
todos:
  - id: cc-integration-integrate-cuts
    content: "Apply dependency manifests, proof readers, central policy and template deletions from the completed lanes."
    status: pending
  - id: cc-integration-source-acceptance
    content: "Run affected source/build tests and fork-boundary gates; eliminate obsolete scaffolding tests and document the current contract."
    status: pending
isProject: false
---

# cc-integration

## Execution Notes

This is the sole writer of shared package manifests, root pnpm config/lockfile, policy.ts, patch-inventory.ts, changesets, FORK-DIVERGENCE.md and boundary measurement files. Integrate cc-runtime, cc-analyzer, cc-dependencies and cc-generator before changing downstream consumers. Regenerate lockfiles with pnpm, never by text replacement. Keep changeset scope/versioning aligned with packages actually changed.

Update templates/workspace-scripts and the installed tooling commands to consume canonical inputs. Specifically remove the synthetic API-only binding and make proof-node-backend-federation consume the emitted native envelope. Remove pass-through templates and template patch files once no generated consumer needs them. Remove obsolete patch-parity branches and copied metadata validation in source qualification and production-readiness helpers. Keep meaningful package integrity, identity, ownership, CSP and artifact verification.

Update scripts/ultramodern-production-readiness/{published-create-proof,tractor-downstream}/ so qualification reads the installed release and canonical app state, and the consumer updater performs an ordinary package-manager adoption rather than copying framework metadata/patches. Preserve the release producer's authenticated manifest and immutable publication checks; distinguish those from the consumer JSON being deleted. Update current maintainer/application guidance in source skill directories, then use pnpm sync:skills for generated mirrors only if their source changed.

Use one compact commit/PR explanation of deletions, native replacements and residual app responsibilities. No new governance dashboard, migration tutorial, custom graph runner or parallel validation subsystem.

## Constraints

Starts after cc-runtime, cc-analyzer, cc-dependencies and cc-generator. Root-only writes to central hotspots listed above; release workflows/source orchestration remain under this owner. Other workers hand patches back and stop writing. No consumer repo changes yet. Do not touch unrelated vanilla Modern.js behavior. Each non-shrink Bucket-B change requires the reviewed inline-patch/upstream/extension disposition and same-PR ledger evidence; use audited base eded841256 and the canonical boundary gate exactly as AGENTS.md prescribes.

## Operator Guidance

Verify package builds and affected existing unit/integration suites, lint, pnpm test:ut where required by affected scope, node tests/skill/feature-enable.mjs when skill behavior changes, and node scripts/ultramodern-boundary-check/check-fork-import-boundary.js. Use TraceDecay diagnostics before compiler runs. Do not accept green source tests as proof that published packages work. Stop with a clean committed candidate, complete source tests, and no production reader/writer for either retired consumer path. Snapshot churn alone is not acceptance; retain tests for real failure modes. Report all removed code and any introduced abstractions before package acceptance.
