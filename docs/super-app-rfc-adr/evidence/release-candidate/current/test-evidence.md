author: codex
timestamp: 2026-05-14T23:55:00Z
ticket_id: modernjs-2ub
commit_sha: 9f80a66bf003-dirty
workflow_run_url: local://modernjs-2ub/effect-service-boundary-gate

# Test Evidence

1. `node --test scripts/release-gates/__tests__/validator.test.js`
2. `pnpm --dir packages/cli/plugin-bff exec rstest run tests/regression.test.ts --passWithNoTests`
3. `node scripts/release-gates/validate-release-candidate-gates.js --profile scripts/release-gates/rc-contract-profile.json --evidence-dir docs/super-app-rfc-adr/evidence/release-candidate/current --skip-commands`
4. `pnpm --dir tests run test:superapp-contracts`

## Result

Gate validator tests pass, the targeted plugin-bff regression suite passes with the Effect service propagation contract, release-candidate migration/evidence validation passes with commands skipped, and the superapp contract suite remains the executable build/serve parity proof for generated Effect clients.
