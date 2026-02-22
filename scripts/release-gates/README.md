# Release Contract Gates

This folder contains release-candidate gate tooling for `modernjs-44t.5.5`.

## Files

1. `rc-contract-profile.json`
   - source-of-truth profile for required evidence files, migration contract assertions, and representative gate commands.
2. `module-certification-profile.json`
   - module onboarding certification profile (SDK contract + boundary anti-pattern readiness).
3. `validator.js`
   - reusable validation helpers.
4. `validate-release-candidate-gates.js`
   - CLI entrypoint used by CI and local validation.

## Local usage

Dry-run (skip commands, allow missing evidence):

```bash
node scripts/release-gates/validate-release-candidate-gates.js \
  --profile scripts/release-gates/rc-contract-profile.json \
  --evidence-dir docs/super-app-rfc-adr/evidence/release-candidate/current \
  --allow-missing-evidence \
  --skip-commands
```

Full gate run:

```bash
node scripts/release-gates/validate-release-candidate-gates.js \
  --profile scripts/release-gates/rc-contract-profile.json \
  --evidence-dir docs/super-app-rfc-adr/evidence/release-candidate/current
```

Module certification gate run:

```bash
node scripts/release-gates/validate-release-candidate-gates.js \
  --profile scripts/release-gates/module-certification-profile.json \
  --evidence-dir docs/super-app-rfc-adr/evidence/module-certification/current
```

## Required evidence files

1. `architecture-evidence.md`
2. `validation-evidence.md`
3. `test-evidence.md`
4. `review-evidence.md`

Each file must include metadata fields:

1. `author`
2. `timestamp`
3. `ticket_id`
4. `commit_sha`
5. `workflow_run_url`

Metadata values must be concrete and non-placeholder. Values such as `TBD`,
`TODO`, `unknown`, `n/a`, and empty values are rejected by gate validation.
