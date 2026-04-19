author: codex
timestamp: 2026-04-19T09:18:18Z
ticket_id: modernjs-2ko
commit_sha: 974b6e95ce48-dirty
workflow_run_url: local://modernjs-2ko/module-certification-gates
module_id: example-module
runtime_lane: effect-first

# Validation Evidence

## Commands

1. `pnpm run validate:module-certification-gates`
2. `node scripts/release-gates/validate-release-candidate-gates.js --profile scripts/release-gates/module-certification-profile.json --evidence-dir docs/super-app-rfc-adr/evidence/module-certification/current`

## Result

Module-certification evidence, migration targets, and representative gate commands pass with the stronger-default Modern.js docs/gates refresh in place.
