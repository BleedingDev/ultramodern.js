# Module SDK Contract Validation

This directory provides validation tooling for ticket `modernjs-44t.6.2`.

## Files

1. `validator.js`
   - reusable validators for the shared module contract and optional profile overlays.
2. `validate-module-sdk-contracts.js`
   - CLI entrypoint for CI and local checks.

## Local usage

Validate contract shape only:

```bash
node scripts/module-sdk-contracts/validate-module-sdk-contracts.js \
  --contract docs/super-app-rfc-adr/contracts/module-sdk-contracts.json \
  --skip-manifest-validation
```

Validate contract + one manifest:

```bash
node scripts/module-sdk-contracts/validate-module-sdk-contracts.js \
  --contract docs/super-app-rfc-adr/contracts/module-sdk-contracts.json \
  --manifest docs/super-app-rfc-adr/contracts/module-manifest.example.json
```

Validate contract + all manifests in a directory:

```bash
node scripts/module-sdk-contracts/validate-module-sdk-contracts.js \
  --contract docs/super-app-rfc-adr/contracts/module-sdk-contracts.json \
  --manifest-dir docs/super-app-rfc-adr/contracts/module-manifests
```
