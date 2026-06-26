---
name: ultramodern-rsdoctor-final-validation
overview: Integrate the parallel lanes, resolve contradictions, run focused quality gates, and confirm the graph preserved opt-in RsDoctor with optional non-gating AI analysis.
todos:
  - id: integrate-parallel-lanes
    content: Review merged lane outputs for scope drift, duplicate changes, stale assumptions, and conflicts around the shared RsDoctor Action contract.
    status: pending
  - id: run-focused-gates
    content: Run builder tests, create generator tests, workflow lint where available, and repository gates that are proportionate to the changed files.
    status: pending
  - id: record-followups
    content: File Beads for any remaining work and document residual risk before commit and push.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-final-validation

## Plan-Backed Handoff Bundle

Resolved limits:

- `max_threads=50`
- `max_depth=3`

Resolved graph:

- `graph_id=ultramodern-rsdoctor-action-security-review-plus-7-plans-37e45eab56`
- `selection_hash=37e45eab56`
- `plan_set_hash=547c326ba5`
- `snapshot_path=/Users/satan/side/experiments/modernjs/.codex/plan-graphs/ultramodern-rsdoctor-action-security-review-plus-7-plans-37e45eab56/snapshot.json`
- `state_dir=/Users/satan/side/experiments/modernjs/.codex/plan-graphs/ultramodern-rsdoctor-action-security-review-plus-7-plans-37e45eab56`

Recommended active launch uses six first-wave sidecars plus the primary agent on integration. Keep spawned workers as leaf nodes unless a later operator explicitly redraws the graph.

Exact plan selection:

```bash
--plan .codex/plans/ultramodern-rsdoctor-builder-output.plan.md
--plan .codex/plans/ultramodern-rsdoctor-generated-config.plan.md
--plan .codex/plans/ultramodern-rsdoctor-template-ci.plan.md
--plan .codex/plans/ultramodern-rsdoctor-docs-contract.plan.md
--plan .codex/plans/ultramodern-rsdoctor-generated-validator.plan.md
--plan .codex/plans/ultramodern-rsdoctor-action-security-review.plan.md
--plan .codex/plans/ultramodern-rsdoctor-generator-tests.plan.md
--plan .codex/plans/ultramodern-rsdoctor-final-validation.plan.md
```

Explicit dependency overlay:

```bash
--depends ultramodern-rsdoctor-generated-config:ultramodern-rsdoctor-generator-tests
--depends ultramodern-rsdoctor-template-ci:ultramodern-rsdoctor-generator-tests
--depends ultramodern-rsdoctor-docs-contract:ultramodern-rsdoctor-generator-tests
--depends ultramodern-rsdoctor-generated-validator:ultramodern-rsdoctor-generator-tests
--depends ultramodern-rsdoctor-builder-output:ultramodern-rsdoctor-final-validation
--depends ultramodern-rsdoctor-action-security-review:ultramodern-rsdoctor-final-validation
--depends ultramodern-rsdoctor-generator-tests:ultramodern-rsdoctor-final-validation
```

## Launch Waves

Wave 1:

- `ultramodern-rsdoctor-builder-output` owns builder config and builder tests.
- `ultramodern-rsdoctor-generated-config` owns generated Modern config.
- `ultramodern-rsdoctor-template-ci` owns generated scripts and workflow.
- `ultramodern-rsdoctor-docs-contract` owns generated docs and contract metadata.
- `ultramodern-rsdoctor-generated-validator` owns generated workspace self-validation.
- `ultramodern-rsdoctor-action-security-review` is read-only verification.

Wave 2:

- `ultramodern-rsdoctor-generator-tests` starts after the generator source lanes land.

Wave 3:

- `ultramodern-rsdoctor-final-validation` integrates, runs gates, files follow-ups, commits, and pushes.

## Conflict Hotspots

Single-owner files:

- `packages/cli/builder/src/rsdoctorConfig.ts` is builder-output only.
- `packages/toolkit/create/src/ultramodern-workspace/module-federation.ts` is generated-config only.
- `packages/toolkit/create/src/ultramodern-workspace/package-json.ts` is template-ci only.
- `packages/toolkit/create/src/ultramodern-workspace/contracts.ts` is docs-contract only.
- `packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars` is generated-validator only.
- Generator test and fixture files are generator-tests only.

If any lane needs a file outside its ownership list, it should stop and hand back the requested change instead of editing across lanes.

## Final Verification

Minimum checks:

- Plan graph validation for this selection and dependency overlay.
- Focused builder RsDoctor tests.
- Focused create workspace manifest/content/integration tests.
- Workflow lint or actionlint for rendered/generated workflow when available.
- Existing repo gates that cover changed metadata, package JSON, dependencies, and changesets.

The final result must still satisfy the product boundary: RsDoctor is opt-in, normal builds stay fast, AI analysis is optional and documented, and no app-level shim is added to fake framework behavior.
