author: codex
timestamp: 2026-02-22T00:00:00Z
ticket_id: modernjs-44t.6.4
commit_sha: ae52fa565e80-dirty
workflow_run_url: local://module-certification
module_id: crm-sales
module_family: crm
runtime_lane: effect-first

# Validation Evidence

## Commands

1. `pnpm run validate:module-sdk-contracts`
2. `pnpm run validate:boundary-guards`
3. `node scripts/release-gates/validate-release-candidate-gates.js --profile scripts/release-gates/module-certification-profile.json --evidence-dir docs/super-app-rfc-adr/evidence/module-certification/current`

## Result

All validation commands pass with current contract/profile artifacts.
