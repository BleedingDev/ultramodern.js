# Boundary Anti-Pattern Guards

This directory contains CI/local anti-pattern checks for ticket `modernjs-44t.6.3`.

## Files

1. `profile.json`
   - source-of-truth guard profile.
2. `validator.js`
   - reusable checks:
   - import boundary guards
   - required snippet assertions
   - module forbidden-pattern scanning via shared SDK contract rules and optional profiles
3. `check-boundary-violations.js`
   - CLI entrypoint for CI and local runs.

## Local usage

```bash
node scripts/boundary-guards/check-boundary-violations.js \
  --profile scripts/boundary-guards/profile.json
```

If no module manifests are available in current workspace:

```bash
node scripts/boundary-guards/check-boundary-violations.js \
  --profile scripts/boundary-guards/profile.json \
  --allow-empty-manifests
```
