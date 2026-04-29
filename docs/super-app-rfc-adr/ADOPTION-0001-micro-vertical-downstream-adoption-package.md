# ADOPTION-0001: Micro Vertical Downstream Adoption Package

- Status: Proposed
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-full-micro-verticals-program.plan.md`
- Coordinates:
  - `WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`
  - `GOVERNANCE-0001-micro-vertical-extraction-governance.md`
  - `OPERATIONS-0001-micro-vertical-certification-and-operations.md`

## 1. Purpose

This package is the downstream adoption index for teams building true Micro Verticals on top of the completed Ultramodern framework base.

The framework base already supplies one public preset, router seams, Module Federation SSR contracts, service-contract propagation, and release gates. This adoption package tells teams how to scaffold, extract, certify, operate, and migrate without inventing a bespoke process.

## 2. Milestone Order

Execute adoption in this order:

1. Workspace scaffolding.
2. Extraction governance.
3. Operations certification.

This order is intentional:

1. teams need a stable package topology before extraction review can be meaningful.
2. extraction governance needs ownership metadata before operations can certify blast radius.
3. operations certification needs the final shell, remote, service, and shared-package boundaries.

## 3. Adoption Map

| Team question | Canonical answer |
| --- | --- |
| How do we lay out the repo? | `WORKSPACE-0001-micro-vertical-workspace-scaffolding.md` |
| How do we scaffold shell, remote, and service packages? | `packages/toolkit/create/README.md` and `packages/toolkit/create/template/README.md` |
| When should we extract a remote or service? | `GOVERNANCE-0001-micro-vertical-extraction-governance.md` |
| How do we migrate an existing app? | `MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md` |
| How do we certify production readiness? | `OPERATIONS-0001-micro-vertical-certification-and-operations.md` |
| Which contracts are machine-readable? | `docs/super-app-rfc-adr/contracts/` |
| Which gates prove the package still works? | `CI-GATES-0001-check-and-artifact-map.md` |

## 4. Launch Checklist

Before a team starts a Micro Vertical:

1. choose Golden, Compat, or Experimental lane.
2. scaffold shell, remote, service, and shared packages using the workspace recipes.
3. assign owners for route, remote, service, and shared-package targets.
4. define topology IDs before wiring environment URLs.
5. document rollback controls before canary.
6. run contract gates before production promotion.

## 5. Done State

The downstream adoption story is complete when:

1. teams can scaffold a canonical workspace from existing create surfaces.
2. reviewers have a written extraction rubric and ownership metadata model.
3. operators have release, certification, incident, and rollback guidance.
4. all adoption guidance points back to existing repo fixtures, gates, schemas, and evidence packages.
