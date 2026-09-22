---
name: cc-metadata
overview: "Remove consumer metadata readers and validate the installed framework and canonical application configuration directly."
todos:
  - id: cc-metadata-canonical-readers
    content: "Replace compact-config loading with the agreed canonical inputs and remove the consumer cohort copy requirement."
    status: pending
  - id: cc-metadata-reader-invariants
    content: "Retarget command validation and test actual configuration and installed-dependency failures."
    status: pending
isProject: false
---

# cc-metadata

## Execution Notes

The current load.ts unconditionally requires .modernjs/ultramodern.json. ultramodern-release-cohort.ts exposes readWorkspaceReleaseCohort/copyCreateReleaseCohort, and validation/workspace.ts requires an application projection to equal installed expectations. Remove those consumer obligations entirely. Retain only producer-owned release data needed to verify published package consistency. It must travel in the installed framework package, outside the generated workspace template.

Update existing load/normalize/types, cohort-parity, and validation code to consume cc-contract's sources. Inspect actual installed package manifests/resolution from each workspace member and preserve rejection of incompatible framework dependencies. A copied JSON file is not package integrity evidence; lock integrity and authenticated package publication remain the actual supply evidence. Support local workspace source through the existing build/test path without adding a legacy fallback.

Cover all tooling readers: validation, MF types, Node/Cloudflare output/proofs, performance checks, backend federation, delivery inspection, and add-operation preflight inputs. Return useful missing/conflicting-source errors. Remove old compact source tags, conversion branches, embedded expected compact snapshots, dead validators, and tests asserting retired file bytes. For build-only resolved configuration, use existing Modern.js loading APIs at build time. Lightweight operations must read declarative topology/manifests without requiring deployment secrets or importing business modules.

Own the canonical-reader conversion in src/ultramodern-tooling/**, including commands/validate.ts, commands/routes-generate.ts and commands/cloudflare-output-verify.ts, plus the indirect readers enumerated by cc-contract. Transfer these files to cc-generator only after reader tests pass. Do not claim whole-generator acceptance at this handoff; old emitters are removed in the following lane and integrated package acceptance follows the join.

## Constraints

Own packages/toolkit/ultramodern-create/src/ultramodern-tooling/** after cc-contract handoff; src/ultramodern-release-cohort.ts; src/ultramodern-workspace/cohort-parity.ts; src/ultramodern-workspace/validation/**; reader-facing portions of workspace-validation-contract.ts; and their dedicated tests. Hand off any necessary producer changes in workspace-validation-contract.ts to cc-generator, which starts after this lane. Do not edit generator writers, policy.ts, patch-inventory.ts, templates/workspace-scripts, package manifests, publish scripts, consumer repos, or runtime-envelope code.

## Operator Guidance

Root stays on this critical path while cc-runtime, cc-analyzer and cc-dependencies run. Prove validation succeeds with both deleted metadata files absent; a wrong installed framework version and contradictory app identity must fail. Preserve actual security/ownership checks and prove a unique nondefault setting survives. No fallback reader for the old files, no auto-upgrader, no new wrapper. Stop after reader tests and the input contract are stable enough for cc-generator. Integration owns template/proof call-site updates across lane boundaries.
